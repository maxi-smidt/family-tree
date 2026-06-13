/**
 * Release version bump.
 *
 * Keeps every version-bearing file in sync:
 *   - frontend/package.json + package-lock.json
 *   - backend/pyproject.toml + uv.lock
 *
 * Usage (from frontend/):
 *   npm run bump:patch|bump:minor|bump:major          bump files only
 *   npm run release:patch|release:minor|release:major bump + commit + tag vX.Y.Z
 *
 * The displayed app version at runtime comes from Docker build metadata, which
 * CI derives from the v* tag — these files are the release-time source for it.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const repoRoot = path.join(frontendRoot, "..");

const packageJsonPath = path.join(frontendRoot, "package.json");
const packageLockPath = path.join(frontendRoot, "package-lock.json");
const pyprojectPath = path.join(repoRoot, "backend", "pyproject.toml");
const uvLockPath = path.join(repoRoot, "backend", "uv.lock");

const type = process.argv[2]; // 'major', 'minor', or 'patch'
const createTag = process.argv.includes("--tag");

if (!["major", "minor", "patch"].includes(type)) {
  console.error("Please specify version type: major, minor, or patch");
  process.exit(1);
}

function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  if (type === "major") {
    parts[0]++;
    parts[1] = 0;
    parts[2] = 0;
  } else if (type === "minor") {
    parts[1]++;
    parts[2] = 0;
  } else if (type === "patch") {
    parts[2]++;
  }
  return parts.join(".");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

// Update package.json.
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const newVersion = bumpVersion(packageJson.version, type);
packageJson.version = newVersion;
writeJson(packageJsonPath, packageJson);
console.log(`Updated package.json to ${newVersion}`);

// Keep npm's lockfile metadata in sync with package.json.
if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = newVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = newVersion;
  }
  writeJson(packageLockPath, packageLock);
  console.log(`Updated package-lock.json to ${newVersion}`);
}

// Backend: pyproject.toml [project] version + the matching uv.lock entry, so
// `uv sync --frozen` (CI) keeps working without a full `uv lock` run.
const pyproject = fs.readFileSync(pyprojectPath, "utf8");
const bumpedPyproject = pyproject.replace(
  /^version = ".*"$/m,
  `version = "${newVersion}"`,
);
if (bumpedPyproject === pyproject && !pyproject.includes(`"${newVersion}"`)) {
  throw new Error("Could not find the version field in backend/pyproject.toml");
}
fs.writeFileSync(pyprojectPath, bumpedPyproject);
console.log(`Updated backend/pyproject.toml to ${newVersion}`);

const uvLock = fs.readFileSync(uvLockPath, "utf8");
const bumpedUvLock = uvLock.replace(
  /(name = "family-tree-backend"\nversion = )"[^"]*"/,
  `$1"${newVersion}"`,
);
if (bumpedUvLock === uvLock && !uvLock.includes(`version = "${newVersion}"`)) {
  throw new Error("Could not find the family-tree-backend entry in uv.lock");
}
fs.writeFileSync(uvLockPath, bumpedUvLock);
console.log(`Updated backend/uv.lock to ${newVersion}`);

if (createTag) {
  const run = (cmd) => execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
  run(
    "git add frontend/package.json frontend/package-lock.json backend/pyproject.toml backend/uv.lock",
  );
  run(`git commit -m "chore(release): v${newVersion}"`);
  run(`git tag v${newVersion}`);
  console.log(
    `\nCreated release commit and tag v${newVersion}.` +
      `\nPush with: git push && git push origin v${newVersion}`,
  );
} else {
  console.log(
    `\nRelease version bumped to ${newVersion}. Create tag v${newVersion} after merging the release commit` +
      ` (or rerun via "npm run release:${type}" to commit and tag in one go).`,
  );
}
