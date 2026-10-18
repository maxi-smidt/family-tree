import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  version,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";

// Vite emits a same-origin worker asset; document data never goes to a CDN.
GlobalWorkerOptions.workerSrc = workerUrl;

interface DocumentPdfPageProps {
  url: string;
  page: number;
  width: number;
  onPageCount: (count: number) => void;
}

/** Render only the visible PDF page, cancelling work on navigation or close. */
export function DocumentPdfPage({
  url,
  page,
  width,
  onPageCount,
}: DocumentPdfPageProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(true);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError(false);
    const assetBase = `${import.meta.env.BASE_URL}pdfjs/${version}`;
    const task = getDocument({
      url,
      cMapUrl: `${assetBase}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}/standard_fonts/`,
      wasmUrl: `${assetBase}/wasm/`,
      iccUrl: `${assetBase}/iccs/`,
    });
    void task.promise
      .then((document) => {
        if (cancelled) return;
        setPdf(document);
        onPageCount(document.numPages);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url, onPageCount]);

  useEffect(() => {
    if (!pdf || !surface.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("page-image", { page }));
    canvas.className = "mx-auto block";
    setRendering(true);
    setError(false);
    const root = surface.current;
    // Each render owns a canvas, so a cancelled render can never paint over
    // the next page, even when the user resizes or navigates rapidly.
    void pdf
      .getPage(Math.min(Math.max(1, page), pdf.numPages))
      .then(async (pdfPage) => {
        if (cancelled) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const scale = width / original.width;
        // Bound backing-store memory when zoomed into large scans.
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          8192 / width,
          8192 / (original.height * scale),
        );
        const viewport = pdfPage.getViewport({ scale: scale * density });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${viewport.height / density}px`;
        task = pdfPage.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) {
          root.replaceChildren(canvas);
          setRendering(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
      root.replaceChildren();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, page, width, t]);

  return (
    <>
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {t("error")}
        </p>
      ) : (
        rendering && <Spinner className="mx-auto size-5" />
      )}
      <div ref={surface} aria-busy={rendering && !error} />
    </>
  );
}
