import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "dist/server/index.js",
  "dist/client/index.html",
  "dist/.openai/hosting.json",
];

for (const file of requiredFiles) {
  await access(file).catch(() => {
    throw new Error(`Sites build artifact is missing: ${file}`);
  });
}

const hosting = JSON.parse(await readFile("dist/.openai/hosting.json", "utf8"));
if (!("d1" in hosting) || !("r2" in hosting)) {
  throw new Error("Sites hosting metadata must declare d1 and r2 bindings.");
}

await access("dist/server/.dev.vars").then(
  () => {
    throw new Error("Sites build must not contain local environment values.");
  },
  () => undefined,
);
