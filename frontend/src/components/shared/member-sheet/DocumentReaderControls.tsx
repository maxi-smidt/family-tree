import type { KeyboardEventHandler, ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** An overlay: scrolling or zooming the document never moves these controls. */
export function DocumentReaderDock({
  children,
  onKeyDown,
}: {
  children: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  return (
    <div
      role="toolbar"
      aria-label={t("controls")}
      data-slot="document-reader-controls"
      onKeyDown={onKeyDown}
      className="absolute bottom-3 left-1/2 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 rounded-lg border bg-background p-1 shadow-lg"
    >
      {children}
    </div>
  );
}

export function DocumentReaderPagination({
  page,
  count,
  onPageChange,
}: {
  page: number;
  count: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  return (
    <div
      role="group"
      aria-label={t("pages")}
      className="flex shrink-0 items-center gap-0.5"
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="size-6 sm:size-7"
        aria-label={t("previous")}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <Input
        size="sm"
        type="number"
        min={1}
        max={count}
        value={page}
        aria-label={t("page")}
        className="h-7 w-7 border-transparent bg-transparent px-0 text-center text-xs shadow-none sm:w-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isInteger(value) && value >= 1 && value <= count)
            onPageChange(value);
        }}
      />
      <span
        aria-hidden="true"
        className="pr-1 text-xs tabular-nums text-muted-foreground"
      >
        / {count}
      </span>
      <span className="sr-only">{t("of", { count })}</span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="size-6 sm:size-7"
        aria-label={t("next")}
        disabled={page >= count}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

/** Identical zoom affordances for reading and selecting a document excerpt. */
export function DocumentReaderZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
  disabled = false,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        size="icon-xs"
        className="size-6 sm:size-7"
        variant="ghost"
        aria-label={t("zoom-out")}
        disabled={disabled || zoom <= 0.5}
        onClick={onZoomOut}
      >
        <Minus />
      </Button>
      <output
        className="w-9 text-center text-xs tabular-nums sm:w-10"
        aria-live="polite"
      >
        {Math.round(zoom * 100)}%
      </output>
      <Button
        type="button"
        size="icon-xs"
        className="size-6 sm:size-7"
        variant="ghost"
        aria-label={t("zoom-in")}
        disabled={disabled || zoom >= 4}
        onClick={onZoomIn}
      >
        <Plus />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        className="size-6 sm:size-7"
        variant="ghost"
        aria-label={t("fit-width")}
        disabled={disabled}
        onClick={onReset}
      >
        <Maximize />
      </Button>
    </div>
  );
}
