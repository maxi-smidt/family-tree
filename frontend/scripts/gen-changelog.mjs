/**
 * Generates frontend/src/data/changelog.json from the repo-root CHANGELOG.md.
 *
 * The frontend Docker build context is ./frontend (see docker-compose.yml and
 * frontend/Dockerfile's `COPY . .`), so the root CHANGELOG.md is NOT reachable
 * inside a Docker build. The generated JSON is therefore a COMMITTED artifact
 * (like the lockfile), regenerated locally/in CI and checked in — not
 * regenerated as part of the Docker image build.
 *
 * Usage (from frontend/):
 *   node scripts/gen-changelog.mjs            regenerate the committed JSON
 *   node scripts/gen-changelog.mjs --check     verify it's up to date (CI)
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

const checkMode = process.argv.includes("--check");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const sourceExists = await fileExists(sourcePath);

  if (!sourceExists) {
    const outputExists = await fileExists(outputPath);
    if (checkMode) {
      console.error(
        `[gen-changelog] Notice: source CHANGELOG.md not found at ${sourcePath} ` +
          "(expected in a Docker build context). Skipping --check.",
      );
      process.exit(0);
    }
    if (outputExists) {
      console.error(
        `[gen-changelog] Notice: source CHANGELOG.md not found at ${sourcePath}. ` +
          "Leaving the existing committed src/data/changelog.json untouched.",
      );
      process.exit(0);
    }
    console.error(
      `[gen-changelog] Error: neither the source CHANGELOG.md (${sourcePath}) ` +
        `nor an existing committed changelog (${outputPath}) were found. Cannot proceed.`,
    );
    process.exit(1);
  }

  const markdown = await fs.readFile(sourcePath, "utf-8");
  const data = parseChangelog(markdown);
  const serialized = JSON.stringify(data, null, 2) + "\n";

  if (checkMode) {
    const outputExists = await fileExists(outputPath);
    const existing = outputExists
      ? await fs.readFile(outputPath, "utf-8")
      : null;
    if (existing !== serialized) {
      console.error(
        "[gen-changelog] src/data/changelog.json is out of date with CHANGELOG.md.\n" +
          "Run `npm run gen-changelog` and commit the result.",
      );
      process.exit(1);
    }
    console.log("[gen-changelog] src/data/changelog.json is up to date.");
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized);
  console.log(`[gen-changelog] Wrote ${data.length} entries to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
