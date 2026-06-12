import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");

const type = process.argv[2]; // 'major', 'minor', or 'patch'

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

console.log(
  `\nRelease version bumped to ${newVersion}. Create tag v${newVersion} after merging the release commit.`,
);
