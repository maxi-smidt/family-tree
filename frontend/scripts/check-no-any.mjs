import { promises as fs } from "fs";
import { glob } from "glob";

const SRC_DIR = "src";

// Patterns that indicate an explicit `any` type annotation in production code.
// Each regex is applied per-line; a match means the line uses `any`.
const ANY_PATTERNS = [
  /:\s*any\b/, // type annotation:  : any, : any[], etc.
  /<any>/, // generic argument: Array<any>, Promise<any>, etc.
  /\bas\s+any\b/, // type assertion:   foo as any
];

async function main() {
  const prodFiles = await glob(`${SRC_DIR}/**/*.{ts,tsx}`, {
    ignore: [`${SRC_DIR}/**/*.test.{ts,tsx}`, `${SRC_DIR}/**/*.d.ts`],
  });

  const violations = [];

  for (const file of prodFiles) {
    const content = await fs.readFile(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that are purely comments.
      if (/^\s*\/\//.test(line)) continue;
      for (const pattern of ANY_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file, line: i + 1, text: line.trim() });
          break;
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log("✅ No explicit `any` found in production frontend code.");
    return;
  }

  console.error(
    `❌ Explicit \`any\` found in ${violations.length} location(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    "\nReplace with a precise type or `unknown` + narrowing." +
      "\nTest files may use `as any` — if truly necessary, move the cast to a test helper.",
  );
  process.exit(1);
}

main();
