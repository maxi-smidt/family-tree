import { afterEach, describe, expect, it, vi } from "vitest";
import { cropDocumentImage } from "./documentImageCrop";

const image = {
  naturalWidth: 4000,
  naturalHeight: 3000,
  width: 800,
  height: 600,
} as HTMLImageElement;

afterEach(() => vi.restoreAllMocks());

describe("cropDocumentImage", () => {
  it("preserves original scan pixels regardless of the displayed zoom", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, callback) {
        expect(this.width).toBe(2000);
        expect(this.height).toBe(750);
        callback(new Blob(["jpeg"], { type: "image/jpeg" }));
      });
    const crop = { unit: "%" as const, x: 10, y: 20, width: 50, height: 25 };

    const file = await cropDocumentImage(image, crop, "scan-crop.jpg");
    await cropDocumentImage(
      { ...image, width: 1600, height: 1200 } as HTMLImageElement,
      crop,
      "zoomed-crop.jpg",
    );

    expect(drawImage).toHaveBeenNthCalledWith(
      1,
      image,
      400,
      600,
      2000,
      750,
      0,
      0,
      2000,
      750,
    );
    expect(drawImage.mock.calls[1].slice(1)).toEqual(
      drawImage.mock.calls[0].slice(1),
    );
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.95,
    );
    expect(file.name).toBe("scan-crop.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(4);
  });

  it("rejects an empty selection before allocating a canvas", async () => {
    await expect(
      cropDocumentImage(
        image,
        { unit: "%", x: 0, y: 0, width: 0, height: 20 },
        "empty.jpg",
      ),
    ).rejects.toThrow("Empty image selection");
  });

  it("reports an export failure instead of attaching an empty file", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(null),
    );
    await expect(
      cropDocumentImage(
        image,
        { unit: "%", x: 0, y: 0, width: 100, height: 100 },
        "scan.jpg",
      ),
    ).rejects.toThrow("Could not export image");
  });
});
