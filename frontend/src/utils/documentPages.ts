export interface DocumentTextPage {
  page: number;
  /** Editable range in the original Markdown, excluding its page marker. */
  start: number;
  end: number;
  markdown: string;
}

/** Split transcription markers without rewriting whitespace or losing a preamble.
 * Invalid, repeated and out-of-order markers remain ordinary Markdown. */
export function documentTextPages(markdown: string): DocumentTextPage[] {
  const pages: DocumentTextPage[] = [];
  let page = 1;
  let start = 0;
  let marked = false;
  for (const match of markdown.matchAll(/<!--\s*page\s+(\d+)\s*-->/gi)) {
    const next = Number(match[1]);
    if (!Number.isSafeInteger(next) || next < 1 || (marked && next <= page))
      continue;
    if (next === 1 && !markdown.slice(0, match.index).trim()) {
      start = match.index + match[0].length;
    } else if (next === 1) {
      // Keep a preamble editable on page one, including the intervening marker.
      start = 0;
    } else {
      pages.push({
        page,
        start,
        end: match.index,
        markdown: markdown.slice(start, match.index),
      });
      start = match.index + match[0].length;
    }
    page = next;
    marked = true;
  }
  pages.push({
    page,
    start,
    end: markdown.length,
    markdown: markdown.slice(start),
  });
  return pages;
}

/** Replace just one page while preserving all other pages and their markers. */
export function replaceDocumentPage(
  markdown: string,
  page: number,
  value: string,
): string {
  const pages = documentTextPages(markdown);
  const section = pages.find((entry) => entry.page === page);
  if (section)
    return (
      markdown.slice(0, section.start) + value + markdown.slice(section.end)
    );
  // A PDF may contain pages that have not been transcribed yet. Insert their
  // markers in page order; never use a marker number as an array allocation.
  const next = pages.find((entry) => entry.page > page);
  const offset = next
    ? markdown.lastIndexOf("<!--", next.start - 1)
    : markdown.length;
  return `${markdown.slice(0, offset)}\n\n<!-- page ${page} -->\n${value}\n\n${markdown.slice(offset)}`;
}
