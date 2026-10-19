/** Find a cited quote in a file's rendered text, and turn a selection in that
 *  text into a quote with some context around it.
 *
 *  Quotes are kept as words, not positions, so they survive edits of the text.
 *  Matching ignores case, runs of whitespace and Markdown markers, like
 *  `plain_text()` in the backend's `services/documents/citations.py`, which
 *  decides whether a quote is still found. */

const COMMENT = /<!--[\s\S]*?-->/g;
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const TAG = /<[^>]+>/g;
// Emphasis, heading, quote and escape marks render as nothing, so dropping
// them keeps "**Johann**, Sohn" as "johann, sohn". Table pipes separate cells.
const MARKERS = /[*_`~#>\\]/g;
const MARKER_CHAR = /[*_`~#>\\]/;
const CELL = /\|/g;
const SPACE = /\s+/g;

/** Text reduced to the words a reader sees, for comparing quotes. */
export function plainQuoteText(text: string): string {
  return text
    .replace(COMMENT, " ")
    .replace(LINK, "$1")
    .replace(TAG, " ")
    .replace(MARKERS, "")
    .replace(CELL, " ")
    .replace(SPACE, " ")
    .trim()
    .toLowerCase();
}

/** How much context is kept on each side of a quote. */
const CONTEXT = 60;

const BLOCK =
  "p,div,li,h1,h2,h3,h4,h5,h6,td,th,tr,blockquote,pre,ul,ol,table,section,hr";

interface TextIndex {
  /** The root's text, normalised like `plainQuoteText` (lower case, single
   *  spaces, no markers). */
  text: string;
  /** `text` in its original case, for showing the context of a quote. */
  display: string;
  /** For each character of `text`, where it sits in the DOM. */
  points: { node: Text; offset: number }[];
  nodes: Text[];
}

function blockOf(node: Node, root: HTMLElement): Element | null {
  const block = node.parentElement?.closest(BLOCK) ?? null;
  return block && root.contains(block) ? block : root;
}

/** Normalised text of `root` with a map back to DOM positions. Separate
 *  blocks (paragraphs, list items, cells) are joined by a space, the way
 *  a selection's text puts a line break between them. */
function indexText(root: HTMLElement): TextIndex {
  const points: TextIndex["points"] = [];
  const nodes: Text[] = [];
  let text = "";
  let display = "";
  let pendingSpace = false;
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    nodes.push(textNode);
    const block = blockOf(textNode, root);
    if (lastBlock !== null && block !== lastBlock) pendingSpace = true;
    lastBlock = block;
    const value = textNode.nodeValue ?? "";
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (MARKER_CHAR.test(char)) continue;
      if (/\s/.test(char) || char === "|") {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && text.length > 0) {
        text += " ";
        display += " ";
        points.push({ node: textNode, offset: i });
      }
      pendingSpace = false;
      const lower = char.toLowerCase();
      // Lower-casing keeps the length for the scripts this app is used with;
      // map every produced character back to the same source position.
      for (const part of lower) {
        text += part;
        display += lower.length === 1 ? char : part;
        points.push({ node: textNode, offset: i });
      }
    }
  }
  return { text, display, points, nodes };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export interface QuoteAnchor {
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
}

/** The DOM range of `anchor.quote` inside `root`, or `null` when the quote
 *  is not there. When the words occur more than once, the occurrence whose
 *  surroundings best match the saved context wins. */
export function findQuoteRange(
  root: HTMLElement,
  anchor: QuoteAnchor,
): Range | null {
  const needle = plainQuoteText(anchor.quote);
  if (!needle) return null;
  const index = indexText(root);
  const prefix = plainQuoteText(anchor.prefix ?? "");
  const suffix = plainQuoteText(anchor.suffix ?? "");
  let best = -1;
  let bestScore = -1;
  for (
    let at = index.text.indexOf(needle);
    at !== -1;
    at = index.text.indexOf(needle, at + 1)
  ) {
    const before = index.text.slice(Math.max(0, at - CONTEXT), at).trimEnd();
    const after = index.text
      .slice(at + needle.length, at + needle.length + CONTEXT)
      .trimStart();
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best === -1) return null;
  const start = index.points[best];
  const end = index.points[best + needle.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** The first text node at or after a boundary point, as a text position. */
function resolvePoint(
  index: TextIndex,
  container: Node,
  offset: number,
): { node: Text; offset: number } | null {
  if (container.nodeType === Node.TEXT_NODE)
    return { node: container as Text, offset };
  const child = container.childNodes[offset] ?? null;
  for (const node of index.nodes) {
    if (child) {
      if (
        child === node ||
        child.contains(node) ||
        child.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
      )
        return { node, offset: 0 };
    } else if (
      !container.contains(node) &&
      container.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      return { node, offset: 0 };
    }
  }
  return null;
}

/** Position in the normalised text of a DOM text position. */
function textPosition(
  index: TextIndex,
  point: { node: Text; offset: number } | null,
): number {
  if (!point) return index.text.length;
  const order = new Map(index.nodes.map((node, i) => [node, i]));
  const nodeAt = order.get(point.node) ?? -1;
  for (let i = 0; i < index.points.length; i++) {
    const p = index.points[i];
    const at = order.get(p.node) ?? -1;
    if (at > nodeAt || (at === nodeAt && p.offset >= point.offset)) return i;
  }
  return index.text.length;
}

/** The quote a selection inside `root` makes, with up to 60 characters of
 *  context on each side; `null` when nothing in `root` is selected. */
export function selectionQuote(
  root: HTMLElement,
  range: Range,
): { quote: string; prefix: string; suffix: string } | null {
  if (range.collapsed || !root.contains(range.commonAncestorContainer))
    return null;
  const quote = range.toString().replace(SPACE, " ").trim();
  if (!plainQuoteText(quote)) return null;
  const index = indexText(root);
  const start = textPosition(
    index,
    resolvePoint(index, range.startContainer, range.startOffset),
  );
  const end = textPosition(
    index,
    resolvePoint(index, range.endContainer, range.endOffset),
  );
  return {
    quote: quote.slice(0, 2000),
    prefix: index.display
      .slice(Math.max(0, start - CONTEXT), start)
      .trimStart(),
    suffix: index.display.slice(end, end + CONTEXT).trimEnd(),
  };
}

type HighlightRegistryLike = Map<string, unknown>;

/** Mark ranges with the CSS Custom Highlight API under `name` (no DOM
 *  changes, so React's tree stays untouched). Browsers without the API skip
 *  the marks. Returns a cleanup. */
export function markRanges(name: string, ranges: Range[]): () => void {
  const highlights = (globalThis.CSS as { highlights?: HighlightRegistryLike })
    ?.highlights;
  if (!highlights || typeof Highlight === "undefined" || ranges.length === 0)
    return () => {};
  highlights.set(name, new Highlight(...ranges));
  return () => highlights.delete(name);
}
