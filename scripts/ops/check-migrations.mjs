import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const migrationDirectory = path.join(root, "supabase", "migrations");
const rollbackDirectory = path.join(root, "supabase", "rollback");
const migrations = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const rollbacks = new Set(
  (await readdir(rollbackDirectory)).filter((file) => file.endsWith(".down.sql")),
);

const errors = [];
const versions = new Set();
for (const file of migrations) {
  const match = /^(\d{12}|\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    errors.push(`${file}: expected a 12/14-digit UTC version and snake_case name`);
    continue;
  }
  if (versions.has(match[1])) errors.push(`${file}: duplicate migration version ${match[1]}`);
  versions.add(match[1]);

  const rollback = file.replace(/\.sql$/, ".down.sql");
  if (!rollbacks.has(rollback)) errors.push(`${file}: missing local-only rollback ${rollback}`);
}

const config = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
if (!/^major_version\s*=\s*17\s*$/m.test(config)) {
  errors.push("supabase/config.toml must use PostgreSQL 17 to match the hosted project");
}

if (process.argv.includes("--linked")) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npx,
    ["--yes", "supabase@2.109.1", "migration", "list", "--linked"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    errors.push("linked migration list failed; authenticate/link Supabase and retry before deployment");
  } else {
    const driftRows = result.stdout
      .split(/\r?\n/)
      .filter((line) => /^\s*\d*\s*│\s*\d*/.test(line))
      .filter((line) => {
        const [local = "", remote = ""] = line.split("│").map((part) => part.trim());
        return local !== remote;
      });
    if (driftRows.length > 0) {
      errors.push(`linked migration ledger drift detected (${driftRows.length} row(s)); do not run db push`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Migration safety check passed for ${migrations.length} migration(s).`);
}
