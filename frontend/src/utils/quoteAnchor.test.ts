import { describe, expect, it } from "vitest";
import { findQuoteRange, plainQuoteText, selectionQuote } from "./quoteAnchor";

function rootWith(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("plainQuoteText", () => {
  it("drops Markdown, case and extra spacing like the backend", () => {
    expect(
      plainQuoteText(
        "# Taufbuch\n\nist **am zwölften März**\n[achtzehn](x) <!-- page 2 -->",
      ),
    ).toBe("taufbuch ist am zwölften märz achtzehn");
  });
});

describe("findQuoteRange", () => {
  it("finds a quote across inline marks and line breaks", () => {
    const root = rootWith(
      "<p>Johann ist <strong>am zwölften März</strong>\nachtzehnhundertneunzig geboren</p>",
    );
    const range = findQuoteRange(root, {
      quote: "am  Zwölften März achtzehnhundertneunzig",
    });
    expect(range?.toString()).toBe("am zwölften März\nachtzehnhundertneunzig");
  });

  it("picks the occurrence whose context matches", () => {
    const root = rootWith(
      "<p>Pate: Georg Hofer, Bauer.</p><p>Mutter: Maria geb. Hofer, Linz.</p>",
    );
    const range = findQuoteRange(root, {
      quote: "Hofer",
      prefix: "Maria geb. ",
      suffix: ", Linz",
    });
    expect(range?.startContainer.textContent).toContain("Maria");
  });

  it("returns null when the words are gone", () => {
    const root = rootWith("<p>Ganz anderer Text</p>");
    expect(findQuoteRange(root, { quote: "Johann" })).toBeNull();
  });
});

describe("selectionQuote", () => {
  it("keeps the selected words and some context on each side", () => {
    const root = rootWith(
      "<h1>Taufbuch</h1><p>Johann Georg Weber, Sohn des Josef</p>",
    );
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Johann Georg Weber".length);

    expect(selectionQuote(root, range)).toEqual({
      quote: "Johann Georg Weber",
      prefix: "Taufbuch",
      suffix: ", Sohn des Josef",
    });
  });

  it("ignores a selection outside the text", () => {
    const root = rootWith("<p>Johann</p>");
    const other = rootWith("<p>Elsewhere</p>");
    const range = document.createRange();
    range.selectNodeContents(other);
    expect(selectionQuote(root, range)).toBeNull();
  });
});
