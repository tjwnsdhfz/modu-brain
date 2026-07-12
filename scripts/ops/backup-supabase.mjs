import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI_VERSION = "2.109.1";
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. It is never written to the backup or console.");
}

const destinationRoot = path.resolve(process.argv[2] || ".backups/supabase");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const destination = path.join(destinationRoot, timestamp);
await mkdir(destination, { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function runDump(file, flags = []) {
  const result = spawnSync(
    npx,
    [
      "--yes",
      `supabase@${CLI_VERSION}`,
      "db",
      "dump",
      "--db-url",
      databaseUrl,
      "--file",
      file,
      ...flags,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "Supabase CLI dump failed")
      .replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]")
      .trim();
    throw new Error(message);
  }
}

const files = {
  roles: path.join(destination, "roles.sql"),
  schema: path.join(destination, "schema.sql"),
  data: path.join(destination, "data.sql"),
  migrationHistory: path.join(destination, "migration-history.sql"),
};

runDump(files.roles, ["--role-only"]);
runDump(files.schema);
runDump(files.data, ["--data-only", "--use-copy"]);
runDump(files.migrationHistory, [
  "--data-only",
  "--use-copy",
  "--schema",
  "supabase_migrations",
]);

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function copyRowCounts(file) {
  const counts = {};
  let table = null;
  for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
    if (!table) {
      const match = /^COPY\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s+\(/.exec(line);
      if (match) {
        table = `${match[1] || "public"}.${match[2]}`;
        counts[table] = 0;
      }
      continue;
    }
    if (line === "\\.") {
      table = null;
      continue;
    }
    counts[table] += 1;
  }
  return counts;
}

const checksums = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([name, file]) => [name, await digest(file)]),
  ),
);

const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout?.trim() || null;

const manifest = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  supabaseCliVersion: CLI_VERSION,
  sourceCommit: commit,
  files: Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, path.basename(file)]),
  ),
  sha256: checksums,
  copyRowCounts: {
    ...await copyRowCounts(files.data),
    ...await copyRowCounts(files.migrationHistory),
  },
  restoreOrder: ["roles", "schema", "data", "migrationHistory"],
};

await writeFile(
  path.join(destination, "backup-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Backup created and checksummed: ${destination}`);
console.log("Copy this directory to an encrypted off-device location before a production migration.");
