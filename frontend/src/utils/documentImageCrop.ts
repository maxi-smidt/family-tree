import type { PercentCrop } from "react-image-crop";
import { getBaseName } from "./attachmentUtils";

// Keep crop exports within mobile canvas limits; unmodified scans bypass canvas.
export const MAX_CROP_DIMENSION = 4096;
const MAX_CROP_PIXELS = 16 * 1024 * 1024;

/** Preserve original bytes for a full page, and alpha for cropped PNG/WebP/GIF scans. */
export async function cropDocumentImage(
  image: HTMLImageElement,
  crop: PercentCrop,
  original: File,
): Promise<File> {
  const x = Math.max(0, Math.round((crop.x / 100) * image.naturalWidth));
  const y = Math.max(0, Math.round((crop.y / 100) * image.naturalHeight));
  const right = Math.min(
    image.naturalWidth,
    Math.round(((crop.x + crop.width) / 100) * image.naturalWidth),
  );
  const bottom = Math.min(
    image.naturalHeight,
    Math.round(((crop.y + crop.height) / 100) * image.naturalHeight),
  );
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) throw new Error("Empty image selection");

  if (
    x === 0 &&
    y === 0 &&
    right === image.naturalWidth &&
    bottom === image.naturalHeight
  ) {
    return original;
  }

  const jpeg =
    original.type === "image/jpeg" ||
    (!original.type && /\.jpe?g$/i.test(original.name));
  const mime = jpeg ? "image/jpeg" : "image/png";
  const scale = Math.min(
    1,
    MAX_CROP_DIMENSION / width,
    MAX_CROP_DIMENSION / height,
    Math.sqrt(MAX_CROP_PIXELS / (width * height)),
  );
  let targetWidth = Math.max(1, Math.floor(width * scale));
  let targetHeight = Math.max(1, Math.floor(height * scale));

  // Some browsers have a smaller allocation budget than their advertised limit.
  // Release each failed canvas before retrying at a lower resolution.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas");
    try {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(
        image,
        x,
        y,
        width,
        height,
        0,
        0,
        targetWidth,
        targetHeight,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, jpeg ? 0.95 : undefined),
      );
      if (blob?.size) {
        const extension = blob.type === "image/jpeg" ? "jpg" : "png";
        return new File(
          [blob],
          `${getBaseName(original.name)}-crop.${extension}`,
          { type: blob.type },
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError")
        throw error;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    targetWidth = Math.max(1, Math.floor(targetWidth / 2));
    targetHeight = Math.max(1, Math.floor(targetHeight / 2));
  }
  throw new Error("Could not export image");
}
