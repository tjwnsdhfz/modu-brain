import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const destinationUrl = process.env.RESTORE_DATABASE_URL?.trim();
const sourceUrl = process.env.DATABASE_URL?.trim();

if (!destinationUrl) throw new Error("RESTORE_DATABASE_URL is required.");
if (!process.argv[2]) throw new Error("Pass the backup directory as the first argument.");
if (sourceUrl && sourceUrl === destinationUrl) {
  throw new Error("Refusing to restore into DATABASE_URL. Use a separate empty verification database.");
}
if (process.env.CONFIRM_RESTORE_TARGET !== "empty-target") {
  throw new Error("Set CONFIRM_RESTORE_TARGET=empty-target after verifying the destination is disposable.");
}

const backupDirectory = path.resolve(process.argv[2]);
const manifestPath = path.join(backupDirectory, "backup-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

for (const name of manifest.restoreOrder) {
  const file = path.join(backupDirectory, manifest.files[name]);
  await access(file);
  const actual = createHash("sha256").update(await readFile(file)).digest("hex");
  if (actual !== manifest.sha256[name]) {
    throw new Error(`Checksum mismatch for ${manifest.files[name]}. Restore stopped.`);
  }
}

function runPsql(args) {
  const environment = { ...process.env, PGDATABASE: destinationUrl };
  delete environment.RESTORE_DATABASE_URL;
  delete environment.DATABASE_URL;
  const result = spawnSync("psql", ["-X", "--set", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("psql was not found. Install the free PostgreSQL 17 client before a restore drill.");
  }
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "psql failed")
      .replaceAll(destinationUrl, "[REDACTED_DATABASE_URL]")
      .trim();
    throw new Error(message);
  }
  return result.stdout.trim();
}

const tableCheck = "select count(*) from pg_tables where schemaname='public' and tablename = any(array['projects','source_records','analysis_runs','analysis_run_sources','share_links','rate_limit_buckets']);";
const existingAppTables = Number(
  runPsql(["--tuples-only", "--no-align", "--command", tableCheck]),
);

if (existingAppTables > 0) {
  throw new Error("Restore target already contains Modu Brain tables. No changes were made.");
}

for (const name of manifest.restoreOrder) {
  runPsql(["--file", path.join(backupDirectory, manifest.files[name])]);
}

const restoredAppTables = Number(
  runPsql(["--tuples-only", "--no-align", "--command", tableCheck]),
);

if (restoredAppTables < 6) {
  throw new Error(`Restore finished but only ${restoredAppTables} core tables were found.`);
}

for (const [qualifiedName, expected] of Object.entries(manifest.copyRowCounts || {})) {
  const [schema, table] = qualifiedName.split(".");
  if (!/^[A-Za-z0-9_]+$/.test(schema) || !/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error(`Unsafe table name in backup manifest: ${qualifiedName}`);
  }
  const actual = Number(runPsql([
    "--tuples-only",
    "--no-align",
    "--command",
    `select count(*) from "${schema}"."${table}";`,
  ]));
  if (actual !== expected) {
    throw new Error(`Row count mismatch for ${qualifiedName}: expected ${expected}, found ${actual}.`);
  }
}

console.log(`Restore drill passed: ${restoredAppTables} core tables found; checksums and row counts matched.`);
