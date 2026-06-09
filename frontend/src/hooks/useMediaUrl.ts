import { useEffect, useState } from "react";
import { getAuthToken } from "@/services/api";

const MEDIA_PREFIX = "/api/media/";

// Module-level cache: media URL -> blob URL. Avoids re-fetching the same file
// during a session. Blob URLs are document-scoped so this is effectively
// application-lifetime — fine because a logout clears store data anyway.
const _cache = new Map<string, string>();

/**
 * Resolves a media URL to one the browser can load without an Authorization
 * header. Non-media URLs (data: URLs, nullish values) are returned unchanged.
 * Media URLs are fetched once with the Bearer token and replaced with a
 * blob URL.
 */
export function useMediaUrl(
  src: string | null | undefined,
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(() => {
    if (!src || !src.startsWith(MEDIA_PREFIX)) return src;
    return _cache.get(src) ?? undefined;
  });

  useEffect(() => {
    if (!src || !src.startsWith(MEDIA_PREFIX)) {
      setResolved(src);
      return;
    }
    if (_cache.has(src)) {
      setResolved(_cache.get(src));
      return;
    }

    let cancelled = false;
    const token = getAuthToken();
    fetch(src, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        _cache.set(src, objectUrl);
        setResolved(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
