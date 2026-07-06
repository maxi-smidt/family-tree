import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSelectionMode } from "./useSelectionMode";

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
