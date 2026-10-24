import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/** Shared document/crop viewport: fit width, local pinch and keyboard zoom, and panning. */
export function useDocumentViewport(supported = true, panEnabled = true) {
  const [previewElement, preview] = useState<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    viewport.current = element;
    setViewportElement(element);
  }, []);
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
    const element = previewElement;
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
  }, [supported, changeZoom, previewElement]);

  useEffect(() => {
    const element = viewportElement;
    if (!element) return;
    const measure = () => {
      // Keep the preview's size while its pane is hidden by the view switcher.
      if (element.clientWidth > 24) setWidth(element.clientWidth - 24);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportElement]);

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
  const panHandlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!supported || !panEnabled) return;
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
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      event.currentTarget.scrollLeft =
        drag.current.left - event.clientX + drag.current.x;
      event.currentTarget.scrollTop =
        drag.current.top - event.clientY + drag.current.y;
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
  };
  return {
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
  };
}
