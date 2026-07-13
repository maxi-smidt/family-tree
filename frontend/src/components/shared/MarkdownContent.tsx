import { lazy, Suspense } from "react";

// The react-markdown/remark/rehype pipeline is heavy (~40 kB gzip) and only
// needed when Markdown is actually shown, so it loads on demand. Keeping it out
// of the eager bundle spares login, the public tree and other lightweight
// routes from downloading it. React.lazy caches the module, so the renderer is
// synchronous after its first use in a session.
const MarkdownRenderer = lazy(() =>
  import("./MarkdownRenderer").then((m) => ({ default: m.MarkdownRenderer })),
);

type Props = {
  content: string;
  className?: string;
};

/**
 * Sanitized Markdown renderer.
 * All biography content MUST flow through this component — rehype-sanitize
 * is the single XSS choke-point for user-supplied Markdown.
 *
 * The styling wrapper below stays eager so surrounding layout is stable while
 * the on-demand renderer chunk loads.
 */
export function MarkdownContent({ content, className }: Props) {
  return (
    <div
      className={[
        "text-sm leading-relaxed",
        "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1",
        "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
        "[&_p]:my-1 [&_p]:whitespace-pre-wrap",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1",
        "[&_li]:my-0.5",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-1",
        "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono",
        "[&_pre]:bg-muted [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1 [&_pre]:overflow-x-auto",
        "[&_hr]:border-muted-foreground/20 [&_hr]:my-2",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      <Suspense fallback={null}>
        <MarkdownRenderer content={content} />
      </Suspense>
    </div>
  );
}
