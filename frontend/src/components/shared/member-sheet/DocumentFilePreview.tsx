import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Maximize, Plus, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMediaUrl } from "@/hooks/useMediaUrl";
import type { DocumentFile } from "@/types/document";
import { getFileKind } from "@/utils/attachmentUtils";
import { DocumentReaderDock } from "./DocumentReaderControls";

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
  const preview = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const [imageError, setImageError] = useState(false);

  const changeZoom = useCallback(
    (value: number, point?: { x: number; y: number }) => {
      const next = Math.min(4, Math.max(0.5, value));
      const element = viewport.current;
      if (next === zoomRef.current || !element) return;
      const ratio = next / zoomRef.current;
      const box = element.getBoundingClientRect();
      const x = point ? point.x - box.left : element.clientWidth / 2;
      const y = point ? point.y - box.top : element.clientHeight / 2;
      // Keep the document point under the pointer in place as it scales.
      const scroll = pendingScroll.current ?? {
        left: element.scrollLeft,
        top: element.scrollTop,
      };
      pendingScroll.current = {
        left: Math.max(0, (scroll.left + x - 12) * ratio - x + 12),
        top: Math.max(0, (scroll.top + y - 12) * ratio - y + 12),
      };
      zoomRef.current = next;
      setZoom(next);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!viewport.current || !pendingScroll.current) return;
    viewport.current.scrollLeft = pendingScroll.current.left;
    viewport.current.scrollTop = pendingScroll.current.top;
    pendingScroll.current = null;
  }, [zoom]);

  useEffect(() => {
    const element = preview.current;
    if (!element || !supported) return;
    let gestureZoom: number | null = null;
    const wheel = (event: WheelEvent) => {
      // Trackpad pinch is delivered as Ctrl+wheel by Chromium and Firefox.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (gestureZoom !== null) return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      changeZoom(zoomRef.current * Math.exp(-delta * 0.01), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    // Safari exposes trackpad pinch through its gesture events instead.
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureZoom = zoomRef.current;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & {
        scale: number;
        clientX: number;
        clientY: number;
      };
      if (gestureZoom !== null && Number.isFinite(gesture.scale))
        changeZoom(gestureZoom * gesture.scale, {
          x: gesture.clientX,
          y: gesture.clientY,
        });
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      gestureZoom = null;
    };
    // React's wheel listeners are passive, so use a local native listener to
    // cancel browser zoom only while the gesture is over the document.
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    element.addEventListener("gesturestart", gestureStart, {
      passive: false,
      capture: true,
    });
    element.addEventListener("gesturechange", gestureChange, {
      passive: false,
      capture: true,
    });
    element.addEventListener("gestureend", gestureEnd, {
      passive: false,
      capture: true,
    });
    return () => {
      element.removeEventListener("wheel", wheel, true);
      element.removeEventListener("gesturestart", gestureStart, true);
      element.removeEventListener("gesturechange", gestureChange, true);
      element.removeEventListener("gestureend", gestureEnd, true);
    };
  }, [supported, changeZoom]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      // Keep the preview's size while its pane is hidden by the view switcher.
      if (element.clientWidth > 24) setWidth(element.clientWidth - 24);
    };
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
    zoomRef.current = 1;
    pendingScroll.current = null;
    setZoom(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  const zoomShortcut = (event: KeyboardEvent) => {
    if (!supported || (!event.ctrlKey && !event.metaKey) || event.altKey)
      return;
    if (!["+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "0") reset();
    else changeZoom(zoomRef.current + (event.key === "-" ? -0.25 : 0.25));
  };
  return (
    <div ref={preview} className="relative flex min-h-0 flex-1 flex-col">
      {(supported || navigation) && (
        <DocumentReaderDock onKeyDown={zoomShortcut}>
          {navigation}
          {navigation && supported && (
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          )}
          {supported && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                size="icon-xs"
                className="size-6 sm:size-7"
                variant="ghost"
                aria-label={t("zoom-out")}
                disabled={zoom <= 0.5}
                onClick={() => changeZoom(zoomRef.current - 0.25)}
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
                disabled={zoom >= 4}
                onClick={() => changeZoom(zoomRef.current + 0.25)}
              >
                <Plus />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                className="size-6 sm:size-7"
                variant="ghost"
                aria-label={t("fit-width")}
                onClick={reset}
              >
                <Maximize />
              </Button>
            </div>
          )}
        </DocumentReaderDock>
      )}
      <div
        ref={viewport}
        className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3 pb-16"
        data-slot="document-file-viewport"
        tabIndex={supported ? 0 : undefined}
        aria-label={t("file")}
        onKeyDown={zoomShortcut}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
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
    </div>
  );
}
