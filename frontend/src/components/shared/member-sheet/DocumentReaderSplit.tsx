import {
  type CSSProperties,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Columns2, FileImage, FileText } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DocumentReaderView = "document" | "text" | "both";

interface DocumentReaderSplitProps {
  preview: ReactNode;
  children: ReactNode;
  view: DocumentReaderView;
}

/** Compact layout actions beside the reader dialog's close button. */
export function DocumentReaderViewControls({
  view,
  onViewChange,
}: {
  view: DocumentReaderView;
  onViewChange: (view: DocumentReaderView) => void;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const options = [
    { value: "document", label: t("view-document"), Icon: FileImage },
    { value: "text", label: t("view-text"), Icon: FileText },
    { value: "both", label: t("view-both"), Icon: Columns2 },
  ];
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={view}
      onValueChange={(value) => {
        if (value === "document" || value === "text" || value === "both")
          onViewChange(value);
      }}
      aria-label={t("view")}
      className="absolute top-2.5 right-18 text-muted-foreground"
    >
      {options.map(({ value, label, Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={value}
              aria-label={label}
              className="size-7 p-0 data-[state=on]:bg-muted data-[state=on]:text-foreground"
            >
              <Icon aria-hidden="true" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/** A keyboard- and pointer-resizable reader, stacked on phones. */
export function DocumentReaderSplit({
  preview,
  children,
  view,
}: DocumentReaderSplitProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const root = useRef<HTMLDivElement>(null);
  const filePaneId = useId();
  const [ratio, setRatio] = useState(50);
  const resize = (value: number) => setRatio(Math.min(75, Math.max(25, value)));
  return (
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
  );
}
