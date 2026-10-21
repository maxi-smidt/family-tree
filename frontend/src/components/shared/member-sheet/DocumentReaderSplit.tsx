import {
  type CSSProperties,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type DocumentReaderView = "document" | "text" | "both";

interface DocumentReaderSplitProps {
  preview: ReactNode;
  children: ReactNode;
  view: DocumentReaderView;
  onViewChange: (view: DocumentReaderView) => void;
}

/** A keyboard- and pointer-resizable reader, stacked on phones. */
export function DocumentReaderSplit({
  preview,
  children,
  view,
  onViewChange,
}: DocumentReaderSplitProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const root = useRef<HTMLDivElement>(null);
  const filePaneId = useId();
  const textPaneId = useId();
  const [ratio, setRatio] = useState(50);
  const resize = (value: number) => setRatio(Math.min(75, Math.max(25, value)));
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(value) => {
          if (value === "document" || value === "text" || value === "both")
            onViewChange(value);
        }}
        aria-label={t("view")}
        className="shrink-0 self-center"
      >
        <ToggleGroupItem value="document" aria-controls={filePaneId}>
          {t("view-document")}
        </ToggleGroupItem>
        <ToggleGroupItem value="text" aria-controls={textPaneId}>
          {t("view-text")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="both"
          aria-controls={`${filePaneId} ${textPaneId}`}
        >
          {t("view-both")}
        </ToggleGroupItem>
      </ToggleGroup>
      <div
        ref={root}
        data-slot="document-reader"
        data-view={view}
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border",
          view === "both"
            ? "grid-rows-2 md:grid-cols-[var(--reader-columns)] md:grid-rows-1"
            : "grid-rows-1",
        )}
        style={
          {
            "--reader-columns": `${ratio}fr 12px ${100 - ratio}fr`,
          } as CSSProperties
        }
      >
        <section
          id={filePaneId}
          aria-label={t("file")}
          hidden={view === "text"}
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden bg-muted/30",
            view === "text" ? "hidden" : "flex",
          )}
        >
          {preview}
        </section>
        <div
          role="separator"
          tabIndex={0}
          aria-label={t("resize")}
          aria-orientation="vertical"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(ratio)}
          aria-controls={filePaneId}
          hidden={view !== "both"}
          className={cn(
            "hidden touch-none cursor-col-resize items-center justify-center bg-muted outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            view === "both" && "md:flex",
          )}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            resize(
              event.key === "Home"
                ? 25
                : event.key === "End"
                  ? 75
                  : ratio + (event.key === "ArrowLeft" ? -5 : 5),
            );
          }}
          onPointerDown={(event) => {
            if (event.button === 0) {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            if (
              !event.currentTarget.hasPointerCapture(event.pointerId) ||
              !root.current
            )
              return;
            const box = root.current.getBoundingClientRect();
            resize(((event.clientX - box.left) / box.width) * 100);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <span className="h-8 w-1 rounded bg-border" />
        </div>
        <section
          id={textPaneId}
          aria-label={t("text")}
          hidden={view === "document"}
          className={cn(
            "min-h-0 min-w-0 overflow-y-auto overscroll-contain p-3 md:p-4",
            view === "both" && "border-t md:border-t-0",
            view === "document" && "hidden",
          )}
        >
          {children}
        </section>
      </div>
    </>
  );
}
