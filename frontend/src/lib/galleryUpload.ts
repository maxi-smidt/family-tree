import { AuthConfig } from "@/types/user";

type MediaLimits = AuthConfig["media_limits"];

/**
 * Process a gallery file for upload.
 *
 * If storageMode is "original" or "both", the raw file bytes are returned as a
 * data URL. Otherwise the image is downscaled via canvas to the configured
 * dimensions and re-encoded as JPEG at quality 0.8.
 *
 * Throws on read or canvas errors — callers should map these to i18n error keys.
 */
export async function processGalleryFile(
  file: File,
  storageMode: string | undefined,
  mediaLimits: MediaLimits | undefined,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    if (storageMode === "original" || storageMode === "both") {
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result !== "string") {
          reject(new Error("read-error"));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error("read-error"));
      reader.readAsDataURL(file);
      return;
    }

    // Default: downscale and re-encode as JPEG before upload.
    reader.onload = (event) => {
      const base64String = event.target?.result;
      if (typeof base64String !== "string") {
        reject(new Error("read-error"));
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (mediaLimits && width > height) {
          if (width > mediaLimits.stored_image_width) {
            height *= mediaLimits.stored_image_width / width;
            width = mediaLimits.stored_image_width;
          }
        } else if (mediaLimits) {
          if (height > mediaLimits.stored_image_height) {
            width *= mediaLimits.stored_image_height / height;
            height = mediaLimits.stored_image_height;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas-context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("canvas-load"));
      img.src = base64String;
    };
    reader.onerror = () => reject(new Error("read-error"));
    reader.readAsDataURL(file);
  });
}
