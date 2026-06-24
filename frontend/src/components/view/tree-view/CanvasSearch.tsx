import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Member, MemberDB } from "@/types/member";
import { TreeService } from "@/services/TreeService";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;
const SEARCH_DEBOUNCE_MS = 300;

interface CanvasSearchProps {
  members: Member[];
  onLocate: (member: Member) => void;
  className?: string;
  /** Present only when the tree is in windowed (focused) mode. */
  windowed?: boolean;
  treeId?: string;
  onFocusRoot?: (memberId: string) => void;
}

/**
 * Search box rendered on the tree canvas. In normal mode filters members
 * client-side; in windowed mode issues a debounced server-side search and
 * re-roots the neighborhood on select.
 */
export const CanvasSearch = ({
  members,
  onLocate,
  className,
  windowed = false,
  treeId,
  onFocusRoot,
}: CanvasSearchProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.search" });
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [serverResults, setServerResults] = useState<MemberDB[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client-side results for normal mode.
  const clientResults = useMemo(() => {
    if (windowed) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter(
        (m) =>
          m.firstName.toLowerCase().includes(q) ||
          m.lastName.toLowerCase().includes(q) ||
          (m.maidenName?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, MAX_RESULTS);
  }, [members, query, windowed]);

  // Server-side search for windowed mode.
  useEffect(() => {
    if (!windowed || !treeId) return;
    const q = query.trim();
    if (!q) {
      setServerResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await TreeService.searchMembers(treeId, q, MAX_RESULTS);
        setServerResults(results);
      } catch {
        setServerResults([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, windowed, treeId]);

  const results = windowed ? serverResults : clientResults;

  // Keep the active option in range whenever the result set changes.
  useEffect(() => setActiveIndex(0), [results]);

  // Close the dropdown when clicking outside the search box.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as globalThis.Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  const selectClient = (member: Member) => {
    onLocate(member);
    setIsOpen(false);
  };

  const selectServer = (member: MemberDB) => {
    onFocusRoot?.(member.id);
    setQuery("");
    setIsOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[activeIndex];
      if (!item) return;
      if (windowed) {
        selectServer(item as MemberDB);
      } else {
        selectClient(item as Member);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const showResults = isOpen && query.trim().length > 0;
  const showSpinner = windowed && isSearching && query.trim().length > 0;

  return (
    <div ref={containerRef} className={cn("w-64", className)}>
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          placeholder={t("placeholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          className="pl-8 pr-8 bg-background shadow-md"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            aria-label={t("clear")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {showResults && (
        <ul className="mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {showSpinner ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("searching")}
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("no-results")}
            </li>
          ) : windowed ? (
            serverResults.map((member, index) => {
              const name =
                `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                      index === activeIndex
                        ? "bg-accent text-accent-foreground"
                        : ""
                    }`}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => selectServer(member)}
                  >
                    <span className="font-medium">{name || t("unnamed")}</span>
                    {member.maidenName && (
                      <span className="text-xs text-muted-foreground">
                        {t("nee", { name: member.maidenName })}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          ) : (
            clientResults.map((member, index) => (
              <li key={member.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => selectClient(member)}
                >
                  <span className="font-medium">
                    {`${member.firstName} ${member.lastName}`.trim() ||
                      t("unnamed")}
                  </span>
                  {member.maidenName && (
                    <span className="text-xs text-muted-foreground">
                      {t("nee", { name: member.maidenName })}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
