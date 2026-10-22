import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeFullscreen } from "./useNativeFullscreen";

const root = document.documentElement;
const originals = [
  [document, "fullscreenEnabled"],
  [document, "fullscreenElement"],
  [document, "exitFullscreen"],
  [root, "requestFullscreen"],
].map(([object, key]) => ({
  object: object as object,
  key: key as string,
  descriptor: Object.getOwnPropertyDescriptor(object, key as string),
}));

describe("useNativeFullscreen", () => {
  let element: Element | null;
  const request = vi.fn();
  const exit = vi.fn();
  const change = (value: Element | null) => {
    element = value;
    document.dispatchEvent(new Event("fullscreenchange"));
  };

  beforeEach(() => {
    element = null;
    request.mockReset().mockImplementation(async () => change(root));
    exit.mockReset().mockImplementation(async () => change(null));
    Object.defineProperties(document, {
      fullscreenEnabled: { configurable: true, value: true },
      fullscreenElement: { configurable: true, get: () => element },
      exitFullscreen: { configurable: true, value: exit },
    });
    Object.defineProperty(root, "requestFullscreen", {
      configurable: true,
      value: request,
    });
  });

  afterEach(() => {
    for (const { object, key, descriptor } of originals) {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    }
  });

  it("enters native fullscreen on the document root and toggles back", async () => {
    const { result } = renderHook(() => useNativeFullscreen(true));
    await act(() => result.current.toggle());
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(result.current.fullscreen).toBe(true);
    await act(() => result.current.toggle());
    expect(exit).toHaveBeenCalledOnce();
    expect(result.current.fullscreen).toBe(false);
  });

  it("follows native exits such as Escape", async () => {
    const { result } = renderHook(() => useNativeFullscreen(true));
    await act(() => result.current.toggle());
    act(() => change(null));
    expect(result.current.fullscreen).toBe(false);
  });

  it("handles Escape before portalled menus and tooltips can consume it", async () => {
    const { result } = renderHook(() => useNativeFullscreen(true));
    await act(() => result.current.toggle());
    const bubble = vi.fn();
    document.addEventListener("keydown", bubble);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(event);
    });
    document.removeEventListener("keydown", bubble);
    expect(event.defaultPrevented).toBe(true);
    expect(bubble).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledOnce();
    expect(result.current.fullscreen).toBe(false);
  });

  it("exits owned fullscreen when the reader closes", async () => {
    const { result, rerender } = renderHook(
      ({ open }) => useNativeFullscreen(open),
      {
        initialProps: { open: true },
      },
    );
    await act(() => result.current.toggle());
    rerender({ open: false });
    expect(exit).toHaveBeenCalledOnce();
    expect(result.current.fullscreen).toBe(false);
  });

  it("does not exit fullscreen owned by another part of the app", () => {
    element = root;
    const { unmount } = renderHook(() => useNativeFullscreen(true));
    unmount();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits if the reader closes before a pending request completes", async () => {
    let complete!: () => void;
    request.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = () => {
            change(root);
            resolve();
          };
        }),
    );
    const { result, rerender } = renderHook(
      ({ open }) => useNativeFullscreen(open),
      {
        initialProps: { open: true },
      },
    );
    const pending = result.current.toggle();
    rerender({ open: false });
    await act(async () => {
      complete();
      await pending;
    });
    expect(exit).toHaveBeenCalledOnce();
    expect(element).toBeNull();
  });

  it("reports rejected requests without entering fullscreen", async () => {
    request.mockRejectedValue(new Error("Denied"));
    const { result } = renderHook(() => useNativeFullscreen(true));
    await expect(result.current.toggle()).rejects.toThrow("Denied");
    expect(result.current.fullscreen).toBe(false);
  });

  it("does not request fullscreen when the browser does not support it", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => useNativeFullscreen(true));
    expect(result.current.supported).toBe(false);
    await result.current.toggle();
    expect(request).not.toHaveBeenCalled();
  });
});
