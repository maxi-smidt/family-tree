import type { PercentCrop } from "react-image-crop";

/** Export original scan pixels, independent of the editor's zoom level. */
export async function cropDocumentImage(
  image: HTMLImageElement,
  crop: PercentCrop,
  filename: string,
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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error("Could not export image")),
      "image/jpeg",
      0.95,
    );
  });
  return new File([blob], filename, { type: blob.type });
}
