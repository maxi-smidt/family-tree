/** Shared helpers for story file attachments (keep in sync with the backend
 * allowlist in `backend/app/services/storage.py`). */

export const ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "md",
  "rtf",
] as const;

/** `accept` attribute for the file picker. */
export const ATTACHMENT_ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(
  ",",
);

export function getExtension(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const i = clean.lastIndexOf(".");
  return i >= 0 ? clean.slice(i + 1).toLowerCase() : "";
}

export type FileKind = "image" | "pdf" | "sheet" | "doc" | "slides" | "text";

export function getFileKind(
  filename: string,
  mimeType?: string | null,
): FileKind | "file" {
  const ext = getExtension(filename);
  if (
    mimeType?.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)
  )
    return "image";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["doc", "docx", "rtf"].includes(ext)) return "doc";
  if (["ppt", "pptx"].includes(ext)) return "slides";
  if (["txt", "md"].includes(ext)) return "text";
  return "file";
}

export function isImageAttachment(a: {
  filename: string;
  mimeType?: string | null;
}): boolean {
  return getFileKind(a.filename, a.mimeType) === "image";
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a translation-key suffix for an invalid file, or null if it's OK. */
export function attachmentError(
  file: File,
  maxBytes?: number,
): "type" | "size" | null {
  if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name) as never))
    return "type";
  if (maxBytes !== undefined && file.size > maxBytes) return "size";
  return null;
}
