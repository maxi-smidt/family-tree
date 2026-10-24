import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentImageCropDialog } from "./DocumentImageCropDialog";

function editor() {
  render(
    <DocumentImageCropDialog
      image={new File(["scan"], "scan.jpg", { type: "image/jpeg" })}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  return document.querySelector<HTMLDivElement>(
    '[data-slot="document-crop-viewport"]',
  )!;
}

function pointer(element: HTMLElement, type: string, x: number, y: number) {
  fireEvent(
    element,
    Object.assign(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      }),
      { pointerType: "mouse", pointerId: 1 },
    ),
  );
}

describe("DocumentImageCropDialog viewer controls", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(424);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:scan"),
        revokeObjectURL: vi.fn(),
      }),
    );
    HTMLElement.prototype.scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
    ) {
      this.scrollLeft =
        typeof options === "number" ? options : (options?.left ?? 0);
      this.scrollTop = typeof options === "number" ? 0 : (options?.top ?? 0);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses the reader's floating controls without the slider or description", () => {
    editor();
    expect(
      screen.getByRole("toolbar", { name: "Document controls" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("status")).toHaveTextContent("100%");
    expect(
      screen.getByRole("button", { name: "Select crop area" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("zooms around the pointer with pinch and retains ordinary scrolling", () => {
    const viewport = editor();
    const scroll = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    fireEvent(viewport, scroll);
    expect(scroll.defaultPrevented).toBe(false);
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
    expect(screen.getByRole("status")).toHaveTextContent("200%");
    expect(viewport.scrollLeft).toBeCloseTo(100);
    expect(viewport.scrollTop).toBeCloseTo(100);
    expect(
      screen.getByRole("img").parentElement?.parentElement?.parentElement,
    ).toHaveStyle({ width: "800px" });
  });

  it("supports viewer shortcuts and fit width while keeping zoom local", () => {
    const viewport = editor();
    fireEvent.keyDown(viewport, { metaKey: true, key: "+" });
    expect(screen.getByRole("status")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(screen.getByRole("status")).toHaveTextContent("100%");
    expect(viewport.scrollLeft).toBe(0);
    const outside = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      cancelable: true,
    });
    fireEvent(document.body, outside);
    expect(outside.defaultPrevented).toBe(false);
  });

  it("pans only in hand mode so selecting a crop never drags the viewport", () => {
    const viewport = editor();
    viewport.scrollLeft = 200;
    viewport.scrollTop = 100;
    pointer(viewport, "pointerdown", 300, 200);
    pointer(viewport, "pointermove", 200, 150);
    expect(viewport.scrollLeft).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "Pan image" }));
    pointer(viewport, "pointerdown", 300, 200);
    pointer(viewport, "pointermove", 200, 150);
    expect(viewport.scrollLeft).toBe(300);
    expect(viewport.scrollTop).toBe(150);
    pointer(viewport, "pointerup", 200, 150);
    fireEvent.click(screen.getByRole("button", { name: "Select crop area" }));
    pointer(viewport, "pointerdown", 300, 200);
    pointer(viewport, "pointermove", 200, 150);
    expect(viewport.scrollLeft).toBe(300);
  });
});
