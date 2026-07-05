import { describe, it, expect } from "vitest";
import { parseChangelog } from "./parse-changelog.mjs";

describe("parseChangelog", () => {
  it("parses multiple versions with version and date", () => {
    const markdown = `# Changelog

## [Unreleased]

### Added

- Something not yet released.

## [1.2.0] - 2026-07-01

### Added

- Feature A.

## [1.1.0] - 2026-06-01

### Fixed

- Bug B.
`;
    const result = parseChangelog(markdown);
    expect(result).toHaveLength(2);
    expect(result[0].version).toBe("1.2.0");
    expect(result[0].date).toBe("2026-07-01");
    expect(result[1].version).toBe("1.1.0");
    expect(result[1].date).toBe("2026-06-01");
  });

  it("captures the body between headers, trimmed", () => {
    const markdown = `## [1.0.0] - 2026-06-22

### Added

- First feature.
- Second feature.

## [0.9.0] - 2026-06-01

### Added

- Old feature.
`;
    const result = parseChangelog(markdown);
    expect(result[0].body).toBe(
      "### Added\n\n- First feature.\n- Second feature.",
    );
  });

  it("excludes the Unreleased section entirely (case-insensitive)", () => {
    const markdown = `## [unreleased]

### Added

- WIP thing.

## [1.0.0] - 2026-06-22

### Added

- Released thing.
`;
    const result = parseChangelog(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("1.0.0");
    expect(result.some((e) => e.version.toLowerCase() === "unreleased")).toBe(
      false,
    );
  });

  it("handles a missing date on the header", () => {
    const markdown = `## [1.0.0]

### Added

- No date here.
`;
    const result = parseChangelog(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("1.0.0");
    expect(result[0].date).toBe("");
  });

  it("returns [] for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  it("returns [] for garbage input with no headers", () => {
    expect(
      parseChangelog("just some random text\nwith no headers at all"),
    ).toEqual([]);
  });

  it("is robust to non-string input", () => {
    // @ts-expect-error deliberately passing a non-string to test robustness
    expect(parseChangelog(null)).toEqual([]);
    // @ts-expect-error deliberately passing a non-string to test robustness
    expect(parseChangelog(undefined)).toEqual([]);
  });

  it("preserves file order (newest-first as in the source file)", () => {
    const markdown = `## [3.0.0] - 2026-03-01

Body 3

## [2.0.0] - 2026-02-01

Body 2

## [1.0.0] - 2026-01-01

Body 1
`;
    const result = parseChangelog(markdown);
    expect(result.map((e) => e.version)).toEqual(["3.0.0", "2.0.0", "1.0.0"]);
  });
});
