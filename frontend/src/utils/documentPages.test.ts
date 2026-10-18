import { describe, expect, it } from "vitest";
import { documentTextPages, replaceDocumentPage } from "./documentPages";

describe("documentTextPages", () => {
  it("keeps unmarked Markdown intact", () => {
    expect(documentTextPages("# Register\n\nA name")).toEqual([
      { page: 1, start: 0, end: 18, markdown: "# Register\n\nA name" },
    ]);
  });

  it("recognizes page numbers, preserving whitespace and a preamble", () => {
    const markdown =
      "Introduction\n<!-- PAGE 1 -->\nFirst\n<!-- page 3 -->\nThird";
    const pages = documentTextPages(markdown);
    expect(pages.map((entry) => entry.page)).toEqual([1, 3]);
    expect(pages[0].markdown).toContain("Introduction");
    expect(pages[1].markdown).toBe("\nThird");
    for (const entry of pages)
      expect(markdown.slice(entry.start, entry.end)).toBe(entry.markdown);
  });

  it("does not render or edit the normal leading page marker", () => {
    expect(documentTextPages("\n<!-- page 1 -->\nFirst")[0].markdown).toBe(
      "\nFirst",
    );
  });

  it("keeps invalid and repeated markers as content without allocating missing pages", () => {
    const markdown =
      "<!-- page 0 -->\n<!-- page 1 -->A<!-- page 1 -->B<!-- page 9007199254740992 -->C<!-- page 999999 -->Z";
    const pages = documentTextPages(markdown);
    expect(pages).toHaveLength(2);
    expect(pages[0].markdown).toContain("A<!-- page 1 -->B");
    expect(pages[0].markdown).toContain("<!-- page 9007199254740992 -->");
    expect(pages[1].page).toBe(999999);
  });
});

describe("replaceDocumentPage", () => {
  const markdown = "<!-- page 1 -->\nFirst\n\n<!-- page 3 -->\nThird\n";

  it("preserves all other pages and marker bytes when correcting a page", () => {
    expect(replaceDocumentPage(markdown, 3, "\nCorrected\n")).toBe(
      "<!-- page 1 -->\nFirst\n\n<!-- page 3 -->\nCorrected\n",
    );
  });

  it("inserts a missing middle page in order without changing existing text", () => {
    const updated = replaceDocumentPage(markdown, 2, "Second");
    expect(documentTextPages(updated).map((entry) => entry.page)).toEqual([
      1, 2, 3,
    ]);
    expect(updated).toContain("<!-- page 1 -->\nFirst\n");
    expect(updated).toContain("<!-- page 3 -->\nThird\n");
  });

  it("appends text for a later page and can clear a page without dropping its marker", () => {
    const updated = replaceDocumentPage(markdown, 4, "Fourth");
    expect(documentTextPages(updated).map((entry) => entry.page)).toEqual([
      1, 3, 4,
    ]);
    expect(replaceDocumentPage(markdown, 1, "")).toBe(
      "<!-- page 1 --><!-- page 3 -->\nThird\n",
    );
  });

  it("inserts before the page marker even if that page starts with another comment", () => {
    const original = "<!-- page 1 -->First<!-- page 3 --><!-- note -->Third";
    const updated = replaceDocumentPage(original, 2, "Second");
    const pages = documentTextPages(updated);
    expect(pages.map((entry) => entry.page)).toEqual([1, 2, 3]);
    expect(pages[2].markdown).toBe("<!-- note -->Third");
  });
});
