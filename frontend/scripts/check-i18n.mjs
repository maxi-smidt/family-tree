import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";

const SRC_DIR = "src";
const LOCALES_DIR = "src/i18n/locales";

// Keys assembled at runtime via template literals or variable lookup cannot be
// detected by static analysis. List their key prefixes here so the checker does
// not report them as unused. Keep this list in sync with the code that builds
// the keys dynamically.
//
// Format: each entry is a string prefix. Any key whose full dot-path starts
// with one of these prefixes is considered intentionally dynamic.
const DYNAMIC_KEY_PREFIXES = [
  // t(ISSUE_TYPE_KEY[issue.issue_type] ?? "issue-unknown")  — QualityReportView
  "quality-report-view.issue-",
  // t(`severity-${issue.severity}`)  — QualityReportView / IssueCard
  "quality-report-view.severity-",
  // t(`role-${database.role}`)  — DatabaseManagementView
  "database-management-view.role-",
  // t(`files.error-${err}`), t(`files.error-quota-${bucket}`)  — DocumentDialog
  //   (keyPrefix: sheet.member-sheet.documents.dialog)
  "sheet.member-sheet.documents.dialog.files.error-",
  // t(`state-${state}`), t(`names.${flag.name}`), t(`descriptions.${flag.name}`)
  //   — FeatureFlagsPanel (keyPrefix: admin.features)
  "admin.features.state-",
  "admin.features.names.",
  "admin.features.descriptions.",
];

function isDynamicKey(key) {
  return DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

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

function getAllKeys(obj, prefix = "") {
  const keys = [];
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      keys.push(...getAllKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

async function findMissingKeys() {
  const translationFiles = await getTranslationFiles();
  const translations = await loadTranslations(translationFiles);
  const languages = Object.keys(translations);
  const tsFiles = await glob(`${SRC_DIR}/**/*.{ts,tsx}`);

  const missingKeysReport = {};
  const usedKeys = new Set();

  for (const file of tsFiles) {
    const content = await fs.readFile(file, "utf-8");

    // Handle template literal keys like i18n.t(`common.gender.${member.gender}`)
    // This regex matches patterns where the template literal contains an interpolation
    const templateLiteralRegex =
      /(?:i18n\.t|t)\(`([^$`]*?)\$\{[^}]+\}([^`]*)`\)/g;
    let templateMatch;
    while ((templateMatch = templateLiteralRegex.exec(content)) !== null) {
      const prefix = templateMatch[1];
      const suffix = templateMatch[2] || "";
      const baseKey = prefix + suffix;

      // Mark the base path as used (e.g., "common.gender" when using "common.gender.${x}")
      if (prefix) {
        // Add the parent keys as potentially used
        const parts = prefix.split(".");
        for (let i = 0; i < parts.length; i++) {
          const partialKey = parts.slice(0, i + 1).join(".");
          usedKeys.add(partialKey);
        }

        // Also mark all child keys under this path as potentially used
        for (const lang of languages) {
          const value = getNestedValue(
            translations[lang],
            prefix.replace(/\.$/, ""),
          );
          if (value && typeof value === "object") {
            const childKeys = getAllKeys(value, prefix.replace(/\.$/, ""));
            childKeys.forEach((k) => usedKeys.add(k));
          }
        }
      }
    }

    // Handle i18n.t() calls - these always use absolute paths, never keyPrefix
    const i18nTFunctionRegex = /\bi18n\.t\(\s*["']([^"']+)["']\s*[,)]/g;
    let i18nMatch;
    while ((i18nMatch = i18nTFunctionRegex.exec(content)) !== null) {
      const key = i18nMatch[1];
      usedKeys.add(key);

      for (const lang of languages) {
        const keyExists = getNestedValue(translations[lang], key) !== undefined;

        if (!keyExists) {
          if (!missingKeysReport[lang]) missingKeysReport[lang] = {};
          if (!missingKeysReport[lang][key]) missingKeysReport[lang][key] = [];
          if (!missingKeysReport[lang][key].includes(file)) {
            missingKeysReport[lang][key].push(file);
          }
        }
      }
    }

    // Handle standalone t() calls with absolute paths (e.g., in utility functions)
    // These are t() calls that pass translation keys as string literals and look like
    // absolute paths (contain dots and start with known namespaces)
    // This catches cases like: function formatDate(t: (key: string) => string) { t("common.date-unknown") }
    const standaloneTRegex = /\bt\(\s*["']([a-z-]+\.[a-z.-]+)["']\s*[,)]/gi;
    let standaloneMatch;
    while ((standaloneMatch = standaloneTRegex.exec(content)) !== null) {
      const key = standaloneMatch[1];
      // Only process keys that look like absolute translation paths
      // (start with known namespace prefixes)
      if (
        key.startsWith("common.") ||
        key.startsWith("dialog.") ||
        key.startsWith("sidebar.") ||
        key.startsWith("sheet.") ||
        key.startsWith("gallery-view.") ||
        key.startsWith("list-view.") ||
        key.startsWith("tree-view.") ||
        key.startsWith("timeline-view.") ||
        key.startsWith("merge-view.") ||
        key.startsWith("hooks.")
      ) {
        usedKeys.add(key);

        for (const lang of languages) {
          const keyExists =
            getNestedValue(translations[lang], key) !== undefined;

          if (!keyExists) {
            if (!missingKeysReport[lang]) missingKeysReport[lang] = {};
            if (!missingKeysReport[lang][key])
              missingKeysReport[lang][key] = [];
            if (!missingKeysReport[lang][key].includes(file)) {
              missingKeysReport[lang][key].push(file);
            }
          }
        }
      }
    }

    const useTranslationRegex =
      /const\s*{([^}]+)}\s*=\s*useTranslation\(([^)]*)\)/g;
    let declarationMatch;

    while ((declarationMatch = useTranslationRegex.exec(content)) !== null) {
      const destructuredPart = declarationMatch[1];
      const argsPart = declarationMatch[2];

      let tVarName = "t";
      let i18nVarName = null;

      // Check for t variable (possibly renamed)
      const tVarRegex = /\bt\s*:\s*(\w+)/;
      const tVarMatch = destructuredPart.match(tVarRegex);
      if (tVarMatch) {
        tVarName = tVarMatch[1];
      } else if (!/\bt\b/.test(destructuredPart)) {
        // If 't' is not destructured, check if i18n is
        const i18nRegex = /\bi18n\b/;
        if (!i18nRegex.test(destructuredPart)) {
          continue;
        }
      }

      // Check if i18n is also destructured
      if (/\bi18n\b/.test(destructuredPart)) {
        i18nVarName = "i18n";
      }

      let keyPrefix = "";
      const keyPrefixRegex = /keyPrefix:\s*["']([^"']+)["']/;
      const keyPrefixMatch = argsPart.match(keyPrefixRegex);
      if (keyPrefixMatch) {
        keyPrefix = keyPrefixMatch[1];
      }

      // Handle regular t() calls (but not i18n.t() calls)
      const tFunctionRegex = new RegExp(
        `(?<!\\.)\\b${tVarName}\\(\\s*["']([^"']+)["']\\s*[,)]`,
        "g",
      );
      let usageMatch;
      while ((usageMatch = tFunctionRegex.exec(content)) !== null) {
        const key = usageMatch[1];
        const fullKey = keyPrefix ? `${keyPrefix}.${key}` : key;

        // Check if this is a pluralization key by looking for { count: ... } nearby
        const matchStart = usageMatch.index;
        const matchEnd = matchStart + usageMatch[0].length;
        const contextAfter = content.substring(matchEnd, matchEnd + 50);
        const hasCountParam = contextAfter.includes("count:");

        // Check if the translation has pluralization variants (_one, _other)
        // by checking if they exist in any language
        let hasPluralizationVariants = false;
        for (const lang of languages) {
          if (
            getNestedValue(translations[lang], `${fullKey}_one`) !==
              undefined ||
            getNestedValue(translations[lang], `${fullKey}_other`) !== undefined
          ) {
            hasPluralizationVariants = true;
            break;
          }
        }

        const isPluralized = hasCountParam && hasPluralizationVariants;

        // For pluralized keys, mark both _one and _other variants as used
        if (isPluralized) {
          usedKeys.add(fullKey);
          usedKeys.add(`${fullKey}_one`);
          usedKeys.add(`${fullKey}_other`);
        } else {
          usedKeys.add(fullKey);
        }

        for (const lang of languages) {
          let keyExists = false;

          if (isPluralized) {
            // For pluralized keys, check if either _one or _other variant exists
            keyExists =
              getNestedValue(translations[lang], `${fullKey}_one`) !==
                undefined ||
              getNestedValue(translations[lang], `${fullKey}_other`) !==
                undefined;
          } else {
            keyExists =
              getNestedValue(translations[lang], fullKey) !== undefined;
          }

          if (!keyExists) {
            if (!missingKeysReport[lang]) missingKeysReport[lang] = {};
            if (!missingKeysReport[lang][fullKey])
              missingKeysReport[lang][fullKey] = [];
            if (!missingKeysReport[lang][fullKey].includes(file)) {
              missingKeysReport[lang][fullKey].push(file);
            }
          }
        }
      }

      // Handle dynamic t() calls with variables (e.g., tRelation(type.id))
      // When a translation function with keyPrefix is called with a variable,
      // mark all keys under the keyPrefix as potentially used
      if (keyPrefix) {
        const tDynamicCallRegex = new RegExp(
          `(?<!\\.)\\b${tVarName}\\(\\s*([a-zA-Z_$][a-zA-Z0-9_$.\\[\\]]*)\\s*[,)]`,
          "g",
        );
        let dynamicMatch;
        while ((dynamicMatch = tDynamicCallRegex.exec(content)) !== null) {
          const arg = dynamicMatch[1];
          // Check if it's a variable/expression (not a string literal)
          // String literals would have been caught by the previous regex
          if (arg && !arg.startsWith('"') && !arg.startsWith("'")) {
            // Mark all child keys under this keyPrefix as used
            for (const lang of languages) {
              const value = getNestedValue(translations[lang], keyPrefix);
              if (value && typeof value === "object") {
                const childKeys = getAllKeys(value, keyPrefix);
                childKeys.forEach((k) => usedKeys.add(k));
              }
            }
            // Break after first match to avoid marking multiple times
            break;
          }
        }
      }
    }
  }

  return { missingKeysReport, usedKeys };
}

async function findUnusedKeys() {
  const translationFiles = await getTranslationFiles();
  const translations = await loadTranslations(translationFiles);
  const { usedKeys } = await findMissingKeys();

  const unusedKeys = {};

  for (const lang in translations) {
    const allKeys = getAllKeys(translations[lang]);
    const unused = allKeys.filter(
      (key) => !usedKeys.has(key) && !isDynamicKey(key),
    );
    if (unused.length > 0) {
      unusedKeys[lang] = unused;
    }
  }

  return unusedKeys;
}

async function findHardcodedStrings() {
  const tsFiles = await glob(`${SRC_DIR}/**/*.{ts,tsx}`, {
    ignore: [
      `${SRC_DIR}/**/*.test.{ts,tsx}`,
      `${SRC_DIR}/types/**`,
      `${SRC_DIR}/db/**`,
      `${SRC_DIR}/i18n/**`,
    ],
  });

  const hardcodedStrings = [];

  // Common UI text patterns that should be translated
  // These patterns are intentionally conservative to minimize false positives
  const uiTextPatterns = [
    // Attribute patterns: placeholder="Some Text", title="Some Text", etc.
    // Note: aria-label is excluded as it's often used for accessibility with technical terms
    /(?<!aria-)(?:placeholder|title|label|description)\s*=\s*["']([A-Z][a-zA-Z\s]{2,})["']/g,
  ];

  for (const file of tsFiles) {
    const content = await fs.readFile(file, "utf-8");

    // Skip files that don't contain useTranslation (UI primitive components)
    if (file.includes("/ui/") && !content.includes("useTranslation")) {
      continue;
    }

    // Check if this file uses translation functions
    const hasTranslation =
      content.includes("useTranslation") ||
      content.includes("i18n.t(") ||
      content.includes("t(");

    for (const pattern of uiTextPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const text = match[1];
        // Skip common technical terms, variable names, CSS classes, etc.
        if (
          text &&
          !text.match(
            /^(className|onClick|onChange|onSubmit|aria|data|ref|id|key|type|name|value|src|alt|href)$/i,
          ) &&
          !text.match(
            /^(div|span|button|input|select|option|form|label|img|a|p|h\d|ul|li|table|tr|td|th)$/i,
          ) &&
          text.length > 2 &&
          hasTranslation
        ) {
          // Further check: see if the text appears in a translation call nearby
          const matchStart = match.index;
          const contextBefore = content.substring(
            Math.max(0, matchStart - 100),
            matchStart,
          );
          const contextAfter = content.substring(
            matchStart,
            matchStart + match[0].length + 100,
          );
          const isInTranslation =
            contextBefore.includes(`t("${text}"`) ||
            contextBefore.includes(`t('${text}'`) ||
            contextAfter.includes(`t("${text}"`) ||
            contextAfter.includes(`t('${text}'`);

          if (!isInTranslation) {
            hardcodedStrings.push({
              file,
              text,
              line: content.substring(0, match.index).split("\n").length,
            });
          }
        }
      }
    }
  }

  return hardcodedStrings;
}

async function main() {
  console.log("🔍 Checking i18n implementation...\n");

  let hasErrors = false;

  // Check for missing keys
  const { missingKeysReport } = await findMissingKeys();
  const languagesWithMissingKeys = Object.keys(missingKeysReport);

  if (languagesWithMissingKeys.length > 0) {
    hasErrors = true;
    console.log("❌ Missing i18n keys found:\n");
    for (const lang of languagesWithMissingKeys) {
      console.log(`--- ${lang.toUpperCase()} ---`);
      const keys = Object.keys(missingKeysReport[lang]);
      for (const key of keys) {
        console.log(`  - "${key}"`);
        for (const file of missingKeysReport[lang][key]) {
          console.log(`    - in ${file}`);
        }
      }
      console.log("");
    }
  } else {
    console.log("✅ All i18n keys are in place.");
  }

  // Check for unused keys
  const unusedKeys = await findUnusedKeys();
  const languagesWithUnusedKeys = Object.keys(unusedKeys);

  if (languagesWithUnusedKeys.length > 0) {
    console.log("\n⚠️  Unused i18n keys found:\n");
    for (const lang of languagesWithUnusedKeys) {
      console.log(`--- ${lang.toUpperCase()} ---`);
      for (const key of unusedKeys[lang]) {
        console.log(`  - "${key}"`);
      }
      console.log("");
    }
    console.log(
      "Note: Unused keys don't cause errors but should be reviewed.\n",
    );
  } else {
    console.log("✅ No unused i18n keys found.\n");
  }

  // Check for hardcoded strings (informational only)
  const hardcodedStrings = await findHardcodedStrings();

  if (hardcodedStrings.length > 0) {
    console.log("\n⚠️  Potential hardcoded strings found (review needed):\n");
    for (const item of hardcodedStrings.slice(0, 20)) {
      // Limit output
      console.log(`  - "${item.text}" in ${item.file}:${item.line}`);
    }
    if (hardcodedStrings.length > 20) {
      console.log(`\n  ... and ${hardcodedStrings.length - 20} more\n`);
    }
    console.log(
      "\nNote: Some hardcoded strings might be false positives (technical terms, etc.).\n",
    );
  } else {
    console.log("✅ No obvious hardcoded strings found.\n");
  }

  if (hasErrors) {
    process.exit(1);
  }
}

main();
