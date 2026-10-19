import { render, screen, waitFor } from "@testing-library/react";
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
      <MarkdownContent
        content={'<script>alert("xss")</script>\n\nsafe text'}
      />,
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

  it("typesets the transcription array with its horizontal rule", async () => {
    const source = String.raw`$$
\begin{array}{l}
\text{8} \\
\hline \text{Geb. - Verz.}
\text{Verw.-Abg.} \\
\text{41?}
\end{array}
$$`;
    const { container } = render(<MarkdownContent content={source} />);

    await waitFor(() =>
      expect(container.querySelector(".katex")).not.toBeNull(),
    );
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-html")).not.toBeNull();
    expect(container.querySelectorAll("math mtable mtr")).toHaveLength(3);
    expect(
      container.querySelector("math mtable")?.getAttribute("rowlines"),
    ).toBe("solid none");
    expect(container.querySelector("math")?.textContent).toContain(
      "Geb. - Verz.",
    );
    expect(container.querySelector("math")?.textContent).toContain(
      "Verw.-Abg.",
    );
    expect(container.querySelector("math")?.textContent).toContain("41?");
  });

  it("renders inline math within a paragraph", async () => {
    const { container } = render(
      <MarkdownContent content="Before $E = mc^2$ after" />,
    );
    await screen.findByText(/Before/);

    expect(container.querySelector("p .katex math msup")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders display math with accessible MathML", async () => {
    const { container } = render(
      <MarkdownContent
        content={String.raw`$$
\frac{a}{b}
$$`}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".katex-display")).not.toBeNull(),
    );

    expect(container.querySelector("math")?.getAttribute("display")).toBe(
      "block",
    );
    expect(container.querySelector("math mfrac")).not.toBeNull();
    expect(
      container.querySelector(".katex-html")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("supports fenced math without applying code block styling", async () => {
    const { container } = render(
      <MarkdownContent content={"```math\nx^2\n```"} />,
    );
    await waitFor(() =>
      expect(container.querySelector(".katex-display")).not.toBeNull(),
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
  });

  it("keeps math delimiters literal inside ordinary code", async () => {
    const { container } = render(
      <MarkdownContent content={"`$x$`\n\n```text\n$$y$$\n```"} />,
    );
    await screen.findByText("$x$");
    expect(screen.getByText("$$y$$").tagName).toBe("CODE");
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("keeps rendering the document when a formula is malformed", async () => {
    const { container } = render(
      <MarkdownContent content={String.raw`Before $\frac{$ after`} />,
    );
    await screen.findByText(/Before/);

    expect(container.querySelector(".katex-error")?.textContent).toBe(
      String.raw`\frac{`,
    );
    expect(container.textContent).toContain("after");
  });

  it.each([
    String.raw`\href{javascript:alert(1)}{click}`,
    String.raw`\href{https://example.com}{click}`,
    String.raw`\includegraphics{https://example.com/tracker.png}`,
    String.raw`\htmlStyle{position:fixed;inset:0}{overlay}`,
    String.raw`\htmlClass{untrusted}{content}`,
  ])("blocks trusted-only LaTeX commands: %s", async (formula) => {
    const { container } = render(
      <MarkdownContent content={`Before $${formula}$ after`} />,
    );
    await screen.findByText(/Before/);

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("a, img, script, .untrusted")).toBeNull();
    expect(container.querySelector('[style*="position:fixed"]')).toBeNull();
    expect(container.querySelector("[onerror], [onclick]")).toBeNull();
  });
});
