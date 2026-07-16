/**
 * Generates frontend/src/data/changelog.json from the repo-root CHANGELOG.md.
 *
 * The generated JSON is intentionally ignored by Git. Frontend build and dev
 * lifecycles run this script before Vite so the app always displays the
 * changelog from the source revision being built.
 *
 * Usage (from frontend/):
 *   node scripts/gen-changelog.mjs
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseChangelog } from "./parse-changelog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const repoRoot = path.join(frontendRoot, "..");

const sourcePath = path.resolve(repoRoot, "CHANGELOG.md");
const outputPath = path.join(frontendRoot, "src", "data", "changelog.json");

async function main() {
  const markdown = await fs.readFile(sourcePath, "utf-8");
  const data = parseChangelog(markdown);
  const serialized = JSON.stringify(data, null, 2) + "\n";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized);
  console.log(`[gen-changelog] Wrote ${data.length} entries to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
