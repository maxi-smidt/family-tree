import { useEffect, useState } from "react";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import type { DocumentSearchResult } from "@/types/document";

const DEBOUNCE_MS = 250;
/** Shorter queries would match almost every long text. */
export const MIN_DOCUMENT_QUERY_LENGTH = 2;

/** Server-side document search for a box the user types in: waits for a
 *  pause in typing, ignores answers to queries that are no longer current,
 *  and returns `null` while there is nothing to show. */
export function useDocumentSearch(
  query: string,
  { enabled = true, limit }: { enabled?: boolean; limit?: number } = {},
): { result: DocumentSearchResult | null; loading: boolean; failed: boolean } {
  const searchDocuments = useDocumentStore((s) => s.searchDocuments);
  const [result, setResult] = useState<DocumentSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = query.trim();
  const active = enabled && q.length >= MIN_DOCUMENT_QUERY_LENGTH;

  useEffect(() => {
    if (!active) {
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchDocuments(q, limit)
        .then((found) => {
          if (cancelled) return;
          setResult(found);
          setFailed(false);
        })
        .catch(() => {
          // Keep the last results, but let the caller say the search
          // didn't answer instead of looking like "nothing found".
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, q, limit, searchDocuments]);

  return {
    result: active ? result : null,
    loading: active && loading,
    failed: active && failed,
  };
}
