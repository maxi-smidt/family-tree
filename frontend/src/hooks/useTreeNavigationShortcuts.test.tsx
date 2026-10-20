import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTreeNavigationShortcuts } from "./useTreeNavigationShortcuts";

const viewport = { x: 100, y: 200, zoom: 1.5 };
function navigation() {
  return {
    zoomIn: vi.fn().mockResolvedValue(true),
    zoomOut: vi.fn().mockResolvedValue(true),
    getViewport: vi.fn(() => viewport),
    setViewport: vi.fn().mockResolvedValue(true),
  };
}

describe("tree navigation shortcuts", () => {
  it.each([
    ["ArrowUp", 100, 280],
    ["ArrowDown", 100, 120],
    ["ArrowLeft", 180, 200],
    ["ArrowRight", 20, 200],
  ])("pans with %s without changing zoom", (key, x, y) => {
    const controls = navigation();
    renderHook(() => useTreeNavigationShortcuts(controls));
    expect(fireEvent.keyDown(window, { key })).toBe(false);
    expect(controls.setViewport).toHaveBeenCalledWith({ x, y, zoom: 1.5 });
  });

  it("uses larger Shift+arrow steps and supports holding a key", () => {
    const controls = navigation();
    renderHook(() => useTreeNavigationShortcuts(controls));
    fireEvent.keyDown(window, {
      key: "ArrowRight",
      shiftKey: true,
      repeat: true,
    });
    expect(controls.setViewport).toHaveBeenCalledWith({
      x: -140,
      y: 200,
      zoom: 1.5,
    });
  });

  it("captures arrows on person cards before React Flow can move them", () => {
    const controls = navigation();
    const movePerson = vi.fn();
    renderHook(() => useTreeNavigationShortcuts(controls));
    render(
      <div className="ft-tree-canvas">
        <div tabIndex={0} onKeyDown={movePerson}>
          Anna
        </div>
      </div>,
    );
    fireEvent.keyDown(screen.getByText("Anna"), { key: "ArrowLeft" });
    expect(controls.setViewport).toHaveBeenCalledOnce();
    expect(movePerson).not.toHaveBeenCalled();
  });

  it("leaves arrows in inputs, sidebar controls and menus alone", () => {
    const controls = navigation();
    renderHook(() => useTreeNavigationShortcuts(controls));
    render(
      <>
        <input aria-label="Search" />
        <button>Sidebar</button>
        <div className="ft-tree-canvas">
          <div role="menu">
            <button>Menu item</button>
          </div>
        </div>
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByText("Sidebar"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByText("Menu item"), { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    expect(controls.setViewport).not.toHaveBeenCalled();
  });

  it("zooms with plus, unshifted equals and minus", () => {
    const controls = navigation();
    const { zoomIn, zoomOut } = controls;
    renderHook(() => useTreeNavigationShortcuts(controls));
    fireEvent.keyDown(window, { key: "+", shiftKey: true });
    fireEvent.keyDown(window, { key: "=" });
    fireEvent.keyDown(window, { key: "-", code: "NumpadSubtract" });
    expect(zoomIn).toHaveBeenCalledTimes(2);
    expect(zoomOut).toHaveBeenCalledOnce();
  });

  it("leaves text, numeric fields, browser zoom and IME input alone", () => {
    const controls = navigation();
    renderHook(() => useTreeNavigationShortcuts(controls));
    render(
      <>
        <input aria-label="Year" type="number" />
        <div contentEditable aria-label="Notes" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Year"), { key: "-" });
    fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "+" });
    fireEvent.keyDown(window, { key: "+", metaKey: true });
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    fireEvent.keyDown(window, { key: "=", isComposing: true });
    expect(controls.zoomIn).not.toHaveBeenCalled();
    expect(controls.zoomOut).not.toHaveBeenCalled();
    expect(controls.setViewport).not.toHaveBeenCalled();
  });

  it("does not zoom the canvas behind an open panel", () => {
    const controls = navigation();
    renderHook(() => useTreeNavigationShortcuts(controls));
    render(<div role="dialog">Image editor</div>);
    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "-" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(controls.zoomIn).not.toHaveBeenCalled();
    expect(controls.zoomOut).not.toHaveBeenCalled();
    expect(controls.setViewport).not.toHaveBeenCalled();
  });
});
