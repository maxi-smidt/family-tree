/** Error codes the backend stores for a failed AI transcription (#1123). */
const KNOWN_CODES = new Set([
  "interrupted",
  "timeout",
  "unreachable",
  "provider_error",
  "blocked",
  "empty_result",
  "file_too_large",
  "file_missing",
  "unreadable_key",
  "ai_not_configured",
  "quota_exceeded",
  "unsupported_file",
  "transcription_running",
]);

/** A readable sentence for a stored error (`code` or `code: details`).
 *  `t` is scoped to `sheet.member-sheet.documents.ai`. */
export function transcriptionErrorMessage(
  t: (key: string) => string,
  error: string | null | undefined,
): string {
  const [code, ...rest] = (error ?? "").split(": ");
  const detail = rest.join(": ");
  const message = t(`errors.${KNOWN_CODES.has(code) ? code : "unknown"}`);
  return detail ? `${message} (${detail})` : message;
}
