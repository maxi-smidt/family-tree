import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const constantsJsonPath = path.join(projectRoot, "constants.json");

const type = process.argv[2]; // 'major', 'minor', or 'patch'

if (!["major", "minor", "patch"].includes(type)) {
  console.error("Please specify version type: major, minor, or patch");
  process.exit(1);
}

function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
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

// Update package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const newVersion = bumpVersion(packageJson.version, type);
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
console.log(`Updated package.json to ${newVersion}`);

// Update constants.json
const constantsJson = JSON.parse(fs.readFileSync(constantsJsonPath, "utf8"));
constantsJson.APP_VERSION = newVersion;
fs.writeFileSync(
  constantsJsonPath,
  JSON.stringify(constantsJson, null, 2) + "\n",
);
console.log(`Updated constants.json to ${newVersion}`);

console.log(
  `\nVersion bumped to ${newVersion}. Don't forget to commit and push!`,
);
