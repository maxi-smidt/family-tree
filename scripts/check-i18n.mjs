import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";

const SRC_DIR = "src";
const LOCALES_DIR = "src/i18n/locales";

async function getTranslationFiles() {
  const files = await fs.readdir(LOCALES_DIR);
  return files.filter((file) => file.endsWith(".json"));
}

async function loadTranslations(files) {
  const translations = {};
  for (const file of files) {
    const lang = file.replace(".json", "");
    const content = await fs.readFile(path.join(LOCALES_DIR, file), "utf-8");
    translations[lang] = JSON.parse(content);
  }
  return translations;
}

function getNestedValue(obj, key) {
  return key.split(".").reduce((o, i) => (o ? o[i] : undefined), obj);
}

async function findMissingKeys() {
  const translationFiles = await getTranslationFiles();
  const translations = await loadTranslations(translationFiles);
  const languages = Object.keys(translations);
  const tsFiles = await glob(`${SRC_DIR}/**/*.{ts,tsx}`);

  const missingKeysReport = {};

  for (const file of tsFiles) {
    const content = await fs.readFile(file, "utf-8");

    const useTranslationRegex =
      /const\s*{([^}]+)}\s*=\s*useTranslation\(([^)]*)\)/g;
    let declarationMatch;

    while ((declarationMatch = useTranslationRegex.exec(content)) !== null) {
      const destructuredPart = declarationMatch[1];
      const argsPart = declarationMatch[2];

      let tVarName = "t";
      const tVarRegex = /\bt\s*:\s*(\w+)/;
      const tVarMatch = destructuredPart.match(tVarRegex);
      if (tVarMatch) {
        tVarName = tVarMatch[1];
      } else if (!/\bt\b/.test(destructuredPart)) {
        continue;
      }

      let keyPrefix = "";
      const keyPrefixRegex = /keyPrefix:\s*["']([^"']+)["']/;
      const keyPrefixMatch = argsPart.match(keyPrefixRegex);
      if (keyPrefixMatch) {
        keyPrefix = keyPrefixMatch[1];
      }

      const tFunctionRegex = new RegExp(
        `\\b${tVarName}\\(\\s*["']([^"']+)["']\\s*\\)`,
        "g",
      );
      let usageMatch;
      while ((usageMatch = tFunctionRegex.exec(content)) !== null) {
        const key = usageMatch[1];
        const fullKey = keyPrefix ? `${keyPrefix}.${key}` : key;

        for (const lang of languages) {
          if (!getNestedValue(translations[lang], fullKey)) {
            if (!missingKeysReport[lang]) missingKeysReport[lang] = {};
            if (!missingKeysReport[lang][fullKey])
              missingKeysReport[lang][fullKey] = [];
            if (!missingKeysReport[lang][fullKey].includes(file)) {
              missingKeysReport[lang][fullKey].push(file);
            }
          }
        }
      }
    }
  }

  return missingKeysReport;
}

async function main() {
  const missingKeys = await findMissingKeys();
  const languagesWithMissingKeys = Object.keys(missingKeys);

  if (languagesWithMissingKeys.length > 0) {
    console.log("🌍 Missing i18n keys found:\n");
    for (const lang of languagesWithMissingKeys) {
      console.log(`--- ${lang.toUpperCase()} ---`);
      const keys = Object.keys(missingKeys[lang]);
      for (const key of keys) {
        console.log(`  - "${key}"`);
        for (const file of missingKeys[lang][key]) {
          console.log(`    - in ${file}`);
        }
      }
      console.log("");
    }
    process.exit(1);
  } else {
    console.log("✅ All i18n keys are in place.");
  }
}

main();
