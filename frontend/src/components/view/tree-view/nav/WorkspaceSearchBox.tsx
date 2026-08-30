import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMemberStore } from "@/hooks/useMemberStore";
import { WorkspaceSearchHitDB } from "@/types/member";
import { getMemberFullName, formatMemberSubLabel } from "@/utils/memberUtils";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

interface WorkspaceSearchBoxProps {
  workspaceId: string;
  onSelectHit: (hit: WorkspaceSearchHitDB) => void;
}

/**
 * Search across the caller's whole readable workspace (#1024's paginated,
 * section-aware contract) — not just the currently loaded canvas. Distinct
 * from `CanvasSearch`, which locates a member already resident on the
 * canvas or in another workspace entirely.
 */
export const WorkspaceSearchBox = ({
  workspaceId,
  onSelectHit,
}: WorkspaceSearchBoxProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.search",
  });
  const searchWorkspace = useMemberStore((s) => s.searchWorkspace);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WorkspaceSearchHitDB[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const reqId = ++requestRef.current;
    if (!trimmed) {
      setHits([]);
      setCursor(null);
      setHasMore(false);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await searchWorkspace(workspaceId, trimmed, PAGE_SIZE);
          if (reqId !== requestRef.current) return;
          setHits(result.items);
          setCursor(result.next_cursor);
          setHasMore(result.has_more);
        } catch {
          if (reqId !== requestRef.current) return;
          setHits([]);
          setCursor(null);
          setHasMore(false);
          setError(true);
        } finally {
          if (reqId === requestRef.current) setLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, workspaceId, searchWorkspace]);

  const loadMore = async () => {
    const trimmed = query.trim();
    if (!trimmed || !cursor) return;
    const reqId = requestRef.current;
    setLoadingMore(true);
    try {
      const result = await searchWorkspace(
        workspaceId,
        trimmed,
        PAGE_SIZE,
        cursor,
      );
      if (reqId !== requestRef.current) return;
      setHits((prev) => [...prev, ...result.items]);
      setCursor(result.next_cursor);
      setHasMore(result.has_more);
    } catch {
      if (reqId === requestRef.current) setError(true);
    } finally {
      if (reqId === requestRef.current) setLoadingMore(false);
    }
  };

  return (
    <div className="w-full">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          placeholder={t("placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 pr-8 h-9 text-sm"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={() => setQuery("")}
            aria-label={t("clear")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t("searching")}
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-2 text-sm text-destructive">
              {t("error")}
            </div>
          )}
          {!loading && !error && hits.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t("no-results")}
            </div>
          )}
          {!loading && !error && hits.length > 0 && (
            <ul>
              {hits.map((hit) => {
                const sublabel = formatMemberSubLabel(
                  hit.maidenName,
                  hit.dateOfBirth,
                  (name) => t("nee", { name }),
                );
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => onSelectHit(hit)}
                    >
                      <span className="font-medium">
                        {getMemberFullName(hit) || t("unnamed")}
                      </span>
                      {sublabel && (
                        <span className="text-xs text-muted-foreground">
                          {sublabel}
                        </span>
                      )}
                      <span className="flex flex-wrap gap-1">
                        {hit.sections.map((section) => (
                          <Badge key={section.id} variant="secondary">
                            {section.name}
                          </Badge>
                        ))}
                        {hit.unassigned && (
                          <Badge variant="outline">{t("unassigned")}</Badge>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!loading && hasMore && (
            <button
              type="button"
              className="w-full px-3 py-2 text-center text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? t("loading-more") : t("show-more")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
