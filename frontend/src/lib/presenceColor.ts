/** Deterministic per-user avatar colour + initials for presence chips. */

/**
 * A stable HSL colour derived from a user id. Fixed saturation/lightness keep
 * white text legible in both light and dark themes; only the hue varies, so
 * different users get visibly different chips.
 */
export function presenceColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (Math.imul(hash, 31) + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

/** Up to two uppercase initials from a display name (falls back to "?"). */
export function presenceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
