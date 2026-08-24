import { useEffect, useState } from "react";
import { getAuthToken, getPublicTreeToken } from "@/services/api";

const PROTECTED_MEDIA_PREFIXES = [
  "/api/media/",
  "/api/auth/profile/image/",
  "/api/friends/",
];

function isProtectedMediaUrl(src: string): boolean {
  return PROTECTED_MEDIA_PREFIXES.some((prefix) => src.startsWith(prefix));
}

// Module-level cache: media URL -> blob URL. Avoids re-fetching the same file
// during a session. Blob URLs are document-scoped so this is effectively
// application-lifetime — fine because a logout clears store data anyway.
const _cache = new Map<string, string>();

/**
 * Resolves a media URL to one the browser can load without an Authorization
 * header. Non-media URLs (data: URLs, nullish values) are returned unchanged.
 * Media URLs are fetched once with the Bearer or public-tree unlock token and
 * replaced with a blob URL.
 */
export function useMediaUrl(
  src: string | null | undefined,
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(() => {
    if (!src || !isProtectedMediaUrl(src)) return src;
    return _cache.get(src) ?? undefined;
  });

  useEffect(() => {
    if (!src || !isProtectedMediaUrl(src)) {
      setResolved(src);
      return;
    }
    if (_cache.has(src)) {
      setResolved(_cache.get(src));
      return;
    }

    let cancelled = false;
    const headers = mediaHeaders();
    fetch(src, {
      headers,
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

/** Fetch a media URL with the Bearer token and return a fresh object URL.
 *  Caller owns the returned URL and is responsible for revoking it. */
export async function fetchMediaObjectUrl(src: string): Promise<string> {
  const r = await fetch(src, {
    headers: mediaHeaders(),
  });
  if (!r.ok) throw new Error(String(r.status));
  return URL.createObjectURL(await r.blob());
}

function mediaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  const publicToken = getPublicTreeToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (publicToken) headers["X-Public-Workspace-Token"] = publicToken;
  return headers;
}

/**
 * Download a media file, fetching it with the auth token first so the request
 * carries the Authorization header an <a download> link cannot. Non-media
 * sources (data:/blob: URLs) are downloaded directly.
 */
export async function downloadMedia(
  src: string,
  filename: string,
): Promise<void> {
  const isMedia = isProtectedMediaUrl(src);
  const url = isMedia ? await fetchMediaObjectUrl(`${src}?download=true`) : src;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (isMedia) URL.revokeObjectURL(url);
}

/**
 * Open a media file in a new tab, fetching it with the auth token first.
 * Non-media sources (data:/blob: URLs) are opened directly.
 */
export async function openMedia(src: string): Promise<void> {
  const url = isProtectedMediaUrl(src) ? await fetchMediaObjectUrl(src) : src;
  window.open(url, "_blank", "noopener");
}
