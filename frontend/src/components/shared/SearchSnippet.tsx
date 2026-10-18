import { cn } from "@/lib/utils";

/** A search snippet with its matched words marked. `highlights` are
 *  `[start, end)` character ranges into `text`, as the server sends them. */
export function SearchSnippet({
  text,
  highlights,
  className,
}: {
  text: string;
  highlights: [number, number][];
  className?: string;
}) {
  const parts: { text: string; marked: boolean }[] = [];
  let position = 0;
  for (const [start, end] of highlights) {
    if (start < position || end > text.length || start >= end) continue;
    if (start > position)
      parts.push({ text: text.slice(position, start), marked: false });
    parts.push({ text: text.slice(start, end), marked: true });
    position = end;
  }
  if (position < text.length)
    parts.push({ text: text.slice(position), marked: false });
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {parts.map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-warning-soft px-0.5 font-medium text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
