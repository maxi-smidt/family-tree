import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Preserve only the extra code classes emitted by remark-math. Sanitize user
// content before KaTeX adds its own MathML and inline layout styles, following
// https://github.com/rehypejs/rehype-sanitize#example-math.
const mathSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};

type Props = {
  content: string;
};

/**
 * The actual react-markdown pipeline, isolated into its own module so the
 * heavy Markdown/remark/rehype dependency graph, KaTeX and its CSS stay in an
 * on-demand chunk (loaded lazily by MarkdownContent).
 *
 * rehype-sanitize is the single XSS choke-point for user-supplied Markdown and
 * MUST stay in this pipeline. Render Markdown through MarkdownContent, never by
 * importing this module directly — that keeps the sanitizer non-optional.
 */
export function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeSanitize, mathSchema],
        [rehypeKatex, { trust: false }],
      ]}
    >
      {content}
    </ReactMarkdown>
  );
}
