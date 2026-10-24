import { useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import { useTranslation } from "react-i18next";
import { Crop, Hand, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cropDocumentImage } from "@/utils/documentImageCrop";
import { formatFileSize } from "@/utils/attachmentUtils";
import { useDocumentViewport } from "@/hooks/useDocumentViewport";
import {
  DocumentReaderDock,
  DocumentReaderZoomControls,
} from "./DocumentReaderControls";

const FULL_IMAGE: PercentCrop = {
  unit: "%",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

interface Props {
  image: File;
  maxFileBytes?: number;
  onConfirm: (file: File) => string | void;
  onCancel: () => void;
}

/** Free rectangular crops, preserving original files when the whole scan is kept. */
export function DocumentImageCropDialog({
  image,
  maxFileBytes,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.image-crop",
  });
  const imageRef = useRef<HTMLImageElement>(null);
  const activeRef = useRef(false);
  const [source, setSource] = useState<string>();
  const [crop, setCrop] = useState<PercentCrop>();
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [error, setError] = useState<string>();
  const {
    preview,
    viewportRef,
    width,
    zoom,
    zoomRef,
    changeZoom,
    reset,
    zoomShortcut,
    panHandlers,
  } = useDocumentViewport(!exporting, panMode);

  useEffect(() => {
    activeRef.current = true;
    const url = URL.createObjectURL(image);
    setSource(url);
    return () => {
      activeRef.current = false;
      URL.revokeObjectURL(url);
    };
  }, [image]);

  const confirm = async () => {
    if (!imageRef.current || exporting || !loaded) return;
    setExporting(true);
    setError(undefined);
    try {
      const file = await cropDocumentImage(
        imageRef.current,
        crop ?? FULL_IMAGE,
        image,
      );
      if (!activeRef.current) return;
      if (maxFileBytes !== undefined && file.size > maxFileBytes) {
        setError(t("error-size", { max: formatFileSize(maxFileBytes) }));
        return;
      }
      const rejection = onConfirm(file);
      if (rejection) setError(rejection);
    } catch {
      if (activeRef.current) setError(t("error-export"));
    } finally {
      if (activeRef.current) setExporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-4xl max-h-[90vh] flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div
          ref={preview}
          className="relative flex h-[50vh] min-h-0 flex-col overflow-hidden rounded-md border bg-muted/20"
        >
          <DocumentReaderDock onKeyDown={zoomShortcut}>
            <DocumentReaderZoomControls
              zoom={zoom}
              onZoomOut={() => changeZoom(zoomRef.current - 0.25)}
              onZoomIn={() => changeZoom(zoomRef.current + 0.25)}
              onReset={reset}
              disabled={exporting}
            />
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
            <Button
              type="button"
              size="icon-xs"
              className="size-6 sm:size-7"
              variant={!panMode ? "secondary" : "ghost"}
              aria-label={t("select-area")}
              title={t("select-area")}
              aria-pressed={!panMode}
              disabled={exporting}
              onClick={() => setPanMode(false)}
            >
              <Crop />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              className="size-6 sm:size-7"
              variant={panMode ? "secondary" : "ghost"}
              aria-label={t("pan")}
              title={t("pan")}
              aria-pressed={panMode}
              disabled={exporting}
              onClick={() => setPanMode(true)}
            >
              <Hand />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              className="size-6 sm:size-7"
              variant="ghost"
              aria-label={t("reset")}
              title={t("reset")}
              disabled={exporting}
              onClick={() => {
                setCrop(undefined);
                setPanMode(false);
                reset();
              }}
            >
              <RotateCcw />
            </Button>
          </DocumentReaderDock>
          <div
            ref={viewportRef}
            className={`min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3 pb-16 ${panMode ? "cursor-grab active:cursor-grabbing" : ""}`}
            data-slot="document-crop-viewport"
            tabIndex={0}
            aria-label={t("preview")}
            onKeyDown={zoomShortcut}
            {...panHandlers}
          >
            <div
              className="mx-auto"
              style={{ width: width ? width * zoom : `${zoom * 100}%` }}
            >
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                disabled={exporting || panMode}
                style={{ display: "block" }}
              >
                {source && (
                  <img
                    ref={imageRef}
                    src={source}
                    alt={t("preview")}
                    className="block w-full max-w-none"
                    draggable={false}
                    onLoad={() => setLoaded(true)}
                    onError={() => {
                      setLoaded(false);
                      setError(t("error-load"));
                    }}
                  />
                )}
              </ReactCrop>
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={
              !loaded ||
              (crop !== undefined && (!crop.width || !crop.height)) ||
              exporting
            }
          >
            {exporting && <Spinner />}
            {t("attach")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
