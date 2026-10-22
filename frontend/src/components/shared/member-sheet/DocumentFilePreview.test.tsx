import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DocumentFile } from "@/types/document";
import { DocumentFilePreview } from "./DocumentFilePreview";

vi.mock("@/hooks/useMediaUrl", () => ({
  useMediaUrl: (url: string | undefined) => url,
}));

const file: DocumentFile = {
  id: "file-1",
  kind: "file",
  filename: "scan.png",
  url: "/scan.png",
  mimeType: "image/png",
  size: 100,
  createdAt: "2026-01-01T00:00:00Z",
  hasText: false,
  transcriptionStatus: null,
  transcriptionError: null,
};

function preview(currentFile = file) {
  const result = render(
    <DocumentFilePreview file={currentFile} page={1} onPageCount={vi.fn()} />,
  );
  const viewport = result.container.querySelector<HTMLDivElement>(
    '[data-slot="document-file-viewport"]',
  )!;
  return { ...result, viewport };
}

describe("DocumentFilePreview zoom", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(424);
    HTMLElement.prototype.scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      this.scrollLeft =
        typeof options === "number" ? options : (options?.left ?? 0);
      this.scrollTop =
        typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    });
  });

  it("cancels browser pinch/modified wheel zoom and scales only the document", () => {
    const { viewport } = preview();
    const image = screen.getByRole("img");
    expect(image).toHaveStyle({ width: "400px" });
    const pinch = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -Math.log(2) * 100,
      clientX: 112,
      clientY: 112,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(viewport, pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(image).toHaveStyle({ width: "800px" });
    expect(viewport.scrollLeft).toBeCloseTo(100);
    expect(viewport.scrollTop).toBeCloseTo(100);

    fireEvent.wheel(viewport, { metaKey: true, deltaY: 1000 });
    expect(screen.getByRole("status")).toHaveTextContent("50%");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -1000 });
    expect(screen.getByRole("status")).toHaveTextContent("400%");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  });

  it("preserves normal wheel scrolling and browser zoom outside the preview", () => {
    const { viewport } = preview();
    const scroll = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    fireEvent(viewport, scroll);
    expect(scroll.defaultPrevented).toBe(false);
    const outside = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      cancelable: true,
    });
    fireEvent(document.body, outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("100%");
  });

  it("keeps pinch zoom local when the pointer is over the floating controls", () => {
    preview();
    const wheel = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -Math.log(2) * 100,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByRole("button", { name: "Zoom in" }), wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("200%");
    expect(screen.getByRole("img")).toHaveStyle({ width: "800px" });
  });

  it("supports local Ctrl/Cmd zoom shortcuts and resets to fit width", () => {
    const { viewport } = preview();
    expect(fireEvent.keyDown(viewport, { ctrlKey: true, key: "+" })).toBe(
      false,
    );
    expect(screen.getByRole("status")).toHaveTextContent("125%");
    fireEvent.keyDown(screen.getByRole("button", { name: "Zoom in" }), {
      metaKey: true,
      key: "=",
    });
    expect(screen.getByRole("status")).toHaveTextContent("150%");
    fireEvent.keyDown(viewport, { metaKey: true, key: "-" });
    expect(screen.getByRole("status")).toHaveTextContent("125%");
    fireEvent.keyDown(viewport, { metaKey: true, key: "0" });
    expect(screen.getByRole("status")).toHaveTextContent("100%");
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    expect(fireEvent.keyDown(viewport, { key: "+" })).toBe(true);
  });

  it("handles Safari pinch gestures and removes native listeners on unmount", () => {
    const { viewport, unmount } = preview();
    const start = new Event("gesturestart", { cancelable: true });
    fireEvent(viewport, start);
    expect(start.defaultPrevented).toBe(true);
    const change = Object.assign(
      new Event("gesturechange", { cancelable: true }),
      {
        scale: 2,
        clientX: 112,
        clientY: 112,
      },
    );
    fireEvent(viewport, change);
    expect(change.defaultPrevented).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("200%");
    fireEvent(viewport, new Event("gestureend", { cancelable: true }));
    unmount();
    const wheel = new WheelEvent("wheel", { ctrlKey: true, cancelable: true });
    viewport.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("leaves browser zoom available for files without a supported preview", () => {
    const { viewport } = preview({
      ...file,
      filename: "notes.txt",
      mimeType: "text/plain",
    });
    expect(fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100 })).toBe(
      true,
    );
    expect(fireEvent.keyDown(viewport, { ctrlKey: true, key: "+" })).toBe(true);
  });
});
