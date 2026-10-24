import { afterEach, describe, expect, it, vi } from "vitest";
import { cropDocumentImage, MAX_CROP_DIMENSION } from "./documentImageCrop";

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

    const file = await cropDocumentImage(
      image,
      crop,
      new File(["original"], "scan.jpg", { type: "image/jpeg" }),
    );
    await cropDocumentImage(
      { ...image, width: 1600, height: 1200 } as HTMLImageElement,
      crop,
      new File(["original"], "zoomed.jpg", { type: "image/jpeg" }),
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
        new File([], "empty.jpg"),
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
        { unit: "%", x: 0, y: 0, width: 50, height: 50 },
        new File([], "scan.jpg", { type: "image/jpeg" }),
      ),
    ).rejects.toThrow("Could not export image");
  });

  it("returns the original full-page PNG without canvas allocation or re-encoding", async () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const original = new File(["original PNG bytes"], "transparent.png", {
      type: "image/png",
    });
    const result = await cropDocumentImage(
      image,
      { unit: "%", x: 0, y: 0, width: 100, height: 100 },
      original,
    );
    expect(result).toBe(original);
    expect(result.type).toBe("image/png");
    expect(context).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/webp", "image/gif"])(
    "keeps transparency when cropping %s",
    async (type) => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      const encode = vi
        .spyOn(HTMLCanvasElement.prototype, "toBlob")
        .mockImplementation((callback) =>
          callback(new Blob(["png"], { type: "image/png" })),
        );
      const result = await cropDocumentImage(
        image,
        { unit: "%", x: 0, y: 0, width: 50, height: 50 },
        new File(["original"], "transparent.webp", { type }),
      );
      expect(encode).toHaveBeenCalledWith(
        expect.any(Function),
        "image/png",
        undefined,
      );
      expect(result.type).toBe("image/png");
      expect(result.name).toBe("transparent-crop.png");
    },
  );

  it("bounds large crop canvases and retries smaller after a browser export failure", async () => {
    const canvases: HTMLCanvasElement[] = [];
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback) {
        canvases.push(this);
        sizes.push([this.width, this.height]);
        callback(
          canvases.length === 1
            ? null
            : new Blob(["jpeg"], { type: "image/jpeg" }),
        );
      },
    );
    const result = await cropDocumentImage(
      {
        ...image,
        naturalWidth: 40000,
        naturalHeight: 30000,
      } as HTMLImageElement,
      { unit: "%", x: 0, y: 0, width: 50, height: 50 },
      new File([], "huge.jpg", { type: "image/jpeg" }),
    );
    expect(sizes).toEqual([
      [MAX_CROP_DIMENSION, 3072],
      [MAX_CROP_DIMENSION / 2, 1536],
    ]);
    expect(
      canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true);
    expect(result.type).toBe("image/jpeg");
  });
});
