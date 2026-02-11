import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const tauriConfPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");

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

// Update tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = newVersion;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
console.log(`Updated tauri.conf.json to ${newVersion}`);

// Update Cargo.toml
let cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
// Replace version = "x.y.z" inside [package] block
// This regex looks for version = "..." specifically in the top section usually
cargoToml = cargoToml.replace(
  /^version = "[^"]+"/m,
  `version = "${newVersion}"`,
);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`Updated Cargo.toml to ${newVersion}`);

console.log(
  `\nVersion bumped to ${newVersion}. Don't forget to commit and push!`,
);
