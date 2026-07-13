import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type Props = {
  content: string;
};

/**
 * The actual react-markdown pipeline, isolated into its own module so the
 * heavy Markdown/remark/rehype dependency graph is code-split into an
 * on-demand chunk (loaded lazily by MarkdownContent).
 *
 * rehype-sanitize is the single XSS choke-point for user-supplied Markdown and
 * MUST stay in this pipeline. Render Markdown through MarkdownContent, never by
 * importing this module directly — that keeps the sanitizer non-optional.
 */
export function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
      {content}
    </ReactMarkdown>
  );
}
