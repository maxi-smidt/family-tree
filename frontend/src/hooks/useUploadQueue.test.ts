import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const addGalleryImage = vi.fn();
const refreshGalleryImages = vi.fn();
const refreshStorageUsage = vi.fn();

vi.mock("@/hooks/useGalleryStore", () => ({
  useGalleryStore: {
    getState: () => ({ addGalleryImage, refreshGalleryImages }),
  },
}));

vi.mock("@/hooks/useStorageStore", () => ({
  useStorageStore: { getState: () => ({ refreshStorageUsage }) },
}));

vi.mock("@/hooks/invalidateDerivedViews", () => ({
  invalidateActivityView: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn() },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useUploadQueue } from "./useUploadQueue";

function imageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  refreshGalleryImages.mockResolvedValue(undefined);
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:mock",
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useUploadQueue — auto-dismiss", () => {
  it("clears the queue automatically once every upload succeeds", async () => {
    addGalleryImage.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUploadQueue());

    await act(async () => {
      result.current.enqueue([imageFile("a.png")]);
      // Drain the worker (worker polls with 100ms timers) and settle promises.
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe("done");
    expect(result.current.isActive).toBe(false);
    expect(addGalleryImage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "a" }),
      expect.anything(),
    );

    // The panel should dismiss itself after the linger delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("keeps the queue visible when an upload fails", async () => {
    addGalleryImage.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUploadQueue());

    await act(async () => {
      result.current.enqueue([imageFile("a.png")]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.items[0].status).toBe("failed");

    // Well past the auto-dismiss delay — a failed item must stay put.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe("failed");
  });
});
