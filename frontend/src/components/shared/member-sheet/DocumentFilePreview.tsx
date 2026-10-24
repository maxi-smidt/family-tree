import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { useMediaUrl } from "@/hooks/useMediaUrl";
import type { DocumentFile } from "@/types/document";
import { getFileKind } from "@/utils/attachmentUtils";
import {
  DocumentReaderDock,
  DocumentReaderZoomControls,
} from "./DocumentReaderControls";
import { useDocumentViewport } from "@/hooks/useDocumentViewport";

const PdfPage = lazy(() =>
  import("./DocumentPdfPage").then((m) => ({ default: m.DocumentPdfPage })),
);

interface DocumentFilePreviewProps {
  file: DocumentFile;
  page: number;
  onPageCount: (count: number) => void;
  navigation?: ReactNode;
}

/** Preview protected uploads through the same authenticated media hook as images. */
export function DocumentFilePreview({
  file,
  page,
  onPageCount,
  navigation,
}: DocumentFilePreviewProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const kind = getFileKind(file.filename ?? "", file.mimeType);
  const supported = kind === "pdf" || kind === "image";
  const url = useMediaUrl(supported ? file.url : undefined);
  const {
    preview,
    viewport,
    viewportRef,
    width,
    zoom,
    zoomRef,
    changeZoom,
    reset,
    zoomShortcut,
    panHandlers,
  } = useDocumentViewport(supported);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }, [page]);

  return (
    <div ref={preview} className="relative flex min-h-0 flex-1 flex-col">
      {(supported || navigation) && (
        <DocumentReaderDock onKeyDown={zoomShortcut}>
          {navigation}
          {navigation && supported && (
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          )}
          {supported && (
            <DocumentReaderZoomControls
              zoom={zoom}
              onZoomOut={() => changeZoom(zoomRef.current - 0.25)}
              onZoomIn={() => changeZoom(zoomRef.current + 0.25)}
              onReset={reset}
            />
          )}
        </DocumentReaderDock>
      )}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3 pb-16"
        data-slot="document-file-viewport"
        tabIndex={supported ? 0 : undefined}
        aria-label={t("file")}
        onKeyDown={zoomShortcut}
        {...panHandlers}
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
    </div>
  );
}
