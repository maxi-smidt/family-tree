/**
 * Maps backend machine-code quota-exceeded error strings to i18n keys.
 *
 * The backend raises QuotaExceeded with str(exc) == "quota_exceeded_{bucket}"
 * and the ApiError message carries this detail string directly.
 */

export type QuotaBucket = "media" | "tree";

const QUOTA_ERROR_CODES: Record<string, QuotaBucket> = {
  quota_exceeded_media: "media",
  quota_exceeded_tree: "tree",
};

/** Return the bucket name if the error message is a quota-exceeded code. */
export function getQuotaBucket(message: string): QuotaBucket | null {
  return QUOTA_ERROR_CODES[message] ?? null;
}

/** Map a quota bucket to its i18n toast key (under the given keyPrefix). */
export function quotaToastKey(bucket: QuotaBucket): string {
  return `toast-error-quota-${bucket}`;
}
