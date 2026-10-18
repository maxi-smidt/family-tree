import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

// The react-markdown pipeline is lazy-loaded (see MarkdownContent), so every
// assertion first awaits a rendered node via findBy* to let the on-demand
// renderer chunk resolve.
describe("MarkdownContent", () => {
  it("renders plain text", async () => {
    render(<MarkdownContent content="Hello world" />);
    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("renders bold Markdown", async () => {
    render(<MarkdownContent content="**bold**" />);
    const strong = await screen.findByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("strips script tags (XSS protection)", async () => {
    render(
      <MarkdownContent content={'<script>alert("xss")</script>\n\nsafe text'} />,
    );
    // Wait for the renderer before asserting the sanitized DOM.
    await screen.findByText(/safe text/);
    // rehype-sanitize must remove the script element entirely
    expect(document.querySelector("script")).toBeNull();
  });

  it("strips img onerror payloads (XSS protection)", async () => {
    render(
      <MarkdownContent content='<img src="x" onerror="alert(1)" />text after' />,
    );
    await screen.findByText(/text after/);
    const img = document.querySelector("img");
    // Either the img is removed entirely or the onerror attribute is stripped
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
  });

  it("strips javascript: href links (XSS protection)", async () => {
    render(<MarkdownContent content="[click me](javascript:alert(1))" />);
    const link = await screen.findByText("click me");
    // rehype-sanitize removes javascript: hrefs — either the href is null or absent
    const href = link.getAttribute("href");
    expect(href === null || !href.match(/^javascript:/i)).toBe(true);
  });

  it("preserves safe Markdown links", async () => {
    render(<MarkdownContent content="[Example](https://example.com)" />);
    const link = await screen.findByText("Example");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
  });

  it("renders GFM bullet lists", async () => {
    render(<MarkdownContent content={"- item one\n- item two"} />);
    await screen.findByText("item one");
    const items = document.querySelectorAll("li");
    expect(items).toHaveLength(2);
  });

  it("preserves soft line breaks inside paragraphs", async () => {
    render(<MarkdownContent content={"line one\nline two"} />);
    await screen.findByText(/line one/);
    const paragraph = document.querySelector("p");

    expect(paragraph?.textContent).toBe("line one\nline two");
    expect(paragraph?.parentElement?.className).toContain(
      "[&_p]:whitespace-pre-wrap",
    );
  });
});
