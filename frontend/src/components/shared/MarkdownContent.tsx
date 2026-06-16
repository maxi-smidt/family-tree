import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type Props = {
  content: string;
  className?: string;
};

/**
 * Sanitized Markdown renderer.
 * All biography content MUST flow through this component — rehype-sanitize
 * is the single XSS choke-point for user-supplied Markdown.
 */
export function MarkdownContent({ content, className }: Props) {
  return (
    <div
      className={[
        "text-sm leading-relaxed",
        "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1",
        "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
        "[&_p]:my-1",
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
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
