import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMediaUrl } from "@/hooks/useMediaUrl";
import type { DocumentFile } from "@/types/document";
import { getFileKind } from "@/utils/attachmentUtils";

const PdfPage = lazy(() =>
  import("./DocumentPdfPage").then((m) => ({ default: m.DocumentPdfPage })),
);

interface DocumentFilePreviewProps {
  file: DocumentFile;
  page: number;
  onPageCount: (count: number) => void;
}

/** Preview protected uploads through the same authenticated media hook as images. */
export function DocumentFilePreview({
  file,
  page,
  onPageCount,
}: DocumentFilePreviewProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const kind = getFileKind(file.filename ?? "", file.mimeType);
  const supported = kind === "pdf" || kind === "image";
  const url = useMediaUrl(supported ? file.url : undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(1, element.clientWidth - 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }, [page]);

  const reset = () => {
    setZoom(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  return (
    <>
      {supported && (
        <div
          role="toolbar"
          aria-label={t("zoom")}
          className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-b p-1"
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("zoom-out")}
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <ZoomOut />
          </Button>
          <output
            className="w-12 text-center text-sm tabular-nums"
            aria-live="polite"
          >
            {Math.round(zoom * 100)}%
          </output>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("zoom-in")}
            disabled={zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
          >
            <ZoomIn />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("fit-width")}
            onClick={reset}
          >
            <Maximize />
          </Button>
        </div>
      )}
      <div
        ref={viewport}
        className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3"
        data-slot="document-file-viewport"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft =
            drag.current.left - event.clientX + drag.current.x;
          event.currentTarget.scrollTop =
            drag.current.top - event.clientY + drag.current.y;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {!supported ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("unsupported")}
          </p>
        ) : url === null || imageError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {t("error")}
          </p>
        ) : !url || !width ? (
          <Spinner className="mx-auto size-5" />
        ) : kind === "pdf" ? (
          <Suspense fallback={<Spinner className="mx-auto size-5" />}>
            <PdfPage
              url={url}
              page={page}
              width={width * zoom}
              onPageCount={onPageCount}
            />
          </Suspense>
        ) : (
          <img
            src={url}
            alt={file.filename ?? t("file")}
            draggable={false}
            className="mx-auto block max-w-none"
            style={{ width: width * zoom }}
            onError={() => setImageError(true)}
          />
        )}
      </div>
    </>
  );
}
