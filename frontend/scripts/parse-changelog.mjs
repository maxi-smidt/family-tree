/**
 * Pure parser for the repo-root CHANGELOG.md.
 *
 * Splits the "Keep a Changelog"-formatted markdown into per-version entries
 * so the frontend can render an in-app "What's new" dialog. Kept dependency-
 * free and side-effect-free so it can be unit tested in isolation from the
 * generator script (which handles file I/O).
 */

// Matches level-2 headers like "## [1.4.0] - 2026-07-01" or "## [Unreleased]".
const HEADER_RE = /^##\s*\[([^\]]+)\](?:\s*-\s*(.+?))?\s*$/;

/**
 * @param {string} markdown Raw contents of CHANGELOG.md.
 * @returns {{ version: string, date: string, body: string }[]} Entries in
 *   file order (newest-first, matching the changelog), excluding the
 *   "Unreleased" section.
 */
export function parseChangelog(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return [];

  const lines = markdown.split(/\r?\n/);

  /** @type {{ version: string, date: string, bodyLines: string[] }[]} */
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(HEADER_RE);
    if (match) {
      current = {
        version: match[1].trim(),
        date: (match[2] ?? "").trim(),
        bodyLines: [],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }

  return sections
    .filter((section) => section.version.toLowerCase() !== "unreleased")
    .map((section) => ({
      version: section.version,
      date: section.date,
      body: section.bodyLines.join("\n").trim(),
    }));
}
