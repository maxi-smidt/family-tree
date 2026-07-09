import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { toggleSelectionId, useSelectionMode } from "./useSelectionMode";

describe("useSelectionMode", () => {
  it("starts with selection mode off", () => {
    const { result } = renderHook(() => useSelectionMode());

    expect(result.current.isSelectionMode).toBe(false);
  });

  it("toggles selection mode on and off", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(result.current.isSelectionMode).toBe(true);

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(result.current.isSelectionMode).toBe(false);
  });

  it("calls onEnterSelectionMode only when turning selection mode ON", () => {
    const onEnterSelectionMode = vi.fn();
    const { result } = renderHook(() => useSelectionMode(onEnterSelectionMode));

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.toggleSelectionMode();
    });
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(2);
  });
});

describe("toggleSelectionId", () => {
  it("adds an id that is not currently selected", () => {
    expect([...toggleSelectionId([], "a")]).toEqual(["a"]);
    expect([...toggleSelectionId(["a"], "b")]).toEqual(["a", "b"]);
  });

  it("removes an id that is already selected", () => {
    expect([...toggleSelectionId(["a", "b"], "a")]).toEqual(["b"]);
  });

  it("toggles the same id off after adding it", () => {
    const added = toggleSelectionId(["a"], "b");
    expect(added.has("b")).toBe(true);
    const removed = toggleSelectionId(added, "b");
    expect(removed.has("b")).toBe(false);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    toggleSelectionId(input, "b");
    expect([...input]).toEqual(["a"]);
  });
});
