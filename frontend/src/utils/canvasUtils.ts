import { PixelCrop } from "react-image-crop";

/** Convert a base64 data URL (such as a canvas crop) into an uploadable file. */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL");

  const [, type, encoded] = match;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], filename, { type });
}

export function getCroppedImg(
  image: HTMLImageElement,
  crop: PixelCrop,
  outputWidth?: number,
): string {
  const canvas = document.createElement("canvas");

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  const targetWidth = outputWidth || crop.width;
  const targetHeight = outputWidth
    ? (crop.height / crop.width) * outputWidth
    : crop.height;

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No 2d context");
  }

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return canvas.toDataURL("image/jpeg");
}
