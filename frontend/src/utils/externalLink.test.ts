import { describe, expect, it } from "vitest";
import { externalLinkHref } from "./externalLink";

describe("externalLinkHref", () => {
  it.each([
    "https://example.com/book/?pg=1",
    "http://example.com/",
    "HTTPS://example.com/",
  ])("accepts an absolute web link: %s", (url) => {
    expect(externalLinkHref(url)).toBe(url);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//example.com/",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "not a URL",
  ])("rejects an unsafe destination: %s", (url) => {
    expect(externalLinkHref(url)).toBeUndefined();
  });
});
