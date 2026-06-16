import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders plain text", () => {
    render(<MarkdownContent content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders bold Markdown", () => {
    render(<MarkdownContent content="**bold**" />);
    const strong = document.querySelector("strong");
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe("bold");
  });

  it("strips script tags (XSS protection)", () => {
    render(
      <MarkdownContent content='<script>alert("xss")</script>' />,
    );
    // rehype-sanitize must remove the script element entirely
    expect(document.querySelector("script")).toBeNull();
  });

  it("strips img onerror payloads (XSS protection)", () => {
    render(
      <MarkdownContent content='<img src="x" onerror="alert(1)" />text after' />,
    );
    const img = document.querySelector("img");
    // Either the img is removed entirely or the onerror attribute is stripped
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
    expect(screen.getByText(/text after/)).toBeInTheDocument();
  });

  it("strips javascript: href links (XSS protection)", () => {
    render(
      <MarkdownContent content="[click me](javascript:alert(1))" />,
    );
    const link = document.querySelector("a");
    // rehype-sanitize removes javascript: hrefs — either the href is null or absent
    if (link) {
      const href = link.getAttribute("href");
      expect(href === null || !href.match(/^javascript:/i)).toBe(true);
    }
  });

  it("preserves safe Markdown links", () => {
    render(<MarkdownContent content="[Example](https://example.com)" />);
    const link = document.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("renders GFM bullet lists", () => {
    render(<MarkdownContent content={"- item one\n- item two"} />);
    const items = document.querySelectorAll("li");
    expect(items).toHaveLength(2);
  });
});
