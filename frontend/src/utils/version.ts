/**
 * Version comparison utilities for the release announcement popup.
 *
 * Versions are expected in semver-ish form: optional leading "v", dot-separated
 * numeric segments (e.g. "1.2.3" or "v2.0.0"). Non-numeric, empty, "dev", or
 * "unknown" values are treated as non-versions and are never considered "newer".
 */

const NON_VERSIONS = new Set(["dev", "unknown", ""]);

/** Parse a version string into numeric segments, or null if not parseable. */
function parseVersion(v: string): number[] | null {
  const stripped = v.replace(/^v/, "").trim();
  if (NON_VERSIONS.has(stripped)) return null;
  const parts = stripped.split(".");
  const nums: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || String(n) !== part) return null;
    nums.push(n);
  }
  return nums.length > 0 ? nums : null;
}

/**
 * Compare two version strings.
 *
 * Returns:
 *   positive  — a > b
 *   negative  — a < b
 *   0         — equal
 *
 * Non-parseable versions sort lower than parseable ones.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Returns true when `candidate` is a valid version string and is strictly
 * newer than `baseline`.
 *
 * `baseline === null` means "never acknowledged" — any valid version is newer.
 */
export function isNewerVersion(
  candidate: string,
  baseline: string | null,
): boolean {
  if (!parseVersion(candidate)) return false;
  if (baseline === null) return true;
  return compareVersions(candidate, baseline) > 0;
}
