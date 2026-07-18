import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Member, MemberDB, MemberSearchHitDB } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getMemberSearchText, formatMemberSubLabel } from "@/utils/memberUtils";
import { toast } from "sonner";

const MAX_CURRENT_RESULTS = 8;
const MAX_RESULTS_PER_OTHER_TREE = 8;
const MAX_OTHER_TREE_RESULTS = 40;
const SEARCH_DEBOUNCE_MS = 300;

type CurrentSearchMember = Member | MemberDB;

interface CurrentSearchResult {
  kind: "current";
  member: CurrentSearchMember;
}

interface OtherTreeSearchResult {
  kind: "other";
  member: MemberSearchHitDB;
}

type SearchResult = CurrentSearchResult | OtherTreeSearchResult;

interface OtherTreeGroup {
  treeId: string;
  treeName: string;
  members: MemberSearchHitDB[];
}

interface CanvasSearchProps {
  members: Member[];
  onLocate: (member: Member) => void;
  className?: string;
  /** Present only when the tree is in windowed (focused) mode. */
  windowed?: boolean;
  treeId?: string;
  onFocusRoot?: (memberId: string) => void;
  onOpenOtherTree: (treeId: string, memberId: string) => Promise<void>;
}

function memberName(member: CurrentSearchMember | MemberSearchHitDB): string {
  return `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
}

function memberBirthDate(
  member: CurrentSearchMember | MemberSearchHitDB,
): string | null {
  return "date" in member ? member.date.birth : member.dateOfBirth;
}

/**
 * Search box rendered on the tree canvas. The current tree always finishes
 * first; only then does a second, capped request look through the user's
 * other readable trees.
 */
export const CanvasSearch = ({
  members,
  onLocate,
  className,
  windowed = false,
  treeId,
  onFocusRoot,
  onOpenOtherTree,
}: CanvasSearchProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.search" });
  const searchMembers = useMemberStore((s) => s.searchMembers);
  const searchOtherTrees = useMemberStore((s) => s.searchOtherTrees);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [serverResults, setServerResults] = useState<MemberDB[]>([]);
  const [otherTreeResults, setOtherTreeResults] = useState<MemberSearchHitDB[]>(
    [],
  );
  const [isSearchingCurrent, setIsSearchingCurrent] = useState(false);
  const [isSearchingOtherTrees, setIsSearchingOtherTrees] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);

  // Client-side results for a normally loaded tree are available immediately.
  const clientResults = useMemo(() => {
    if (windowed) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return members
      .filter((member) =>
        getMemberSearchText(member).toLowerCase().includes(normalizedQuery),
      )
      .slice(0, MAX_CURRENT_RESULTS);
  }, [members, query, windowed]);

  // A windowed tree needs a server request to complete its current-tree
  // results. Once that is complete (or a normal tree's local pass is ready),
  // start the second search for other readable trees.
  useEffect(() => {
    const normalizedQuery = query.trim();
    const requestId = ++searchRequestRef.current;
    const isCurrentRequest = () => requestId === searchRequestRef.current;

    setOtherTreeResults([]);
    setIsSearchingOtherTrees(false);

    if (!normalizedQuery) {
      setServerResults([]);
      setIsSearchingCurrent(false);
      return;
    }

    const searchRemainingTrees = async () => {
      setIsSearchingOtherTrees(true);
      try {
        const results = await searchOtherTrees(
          normalizedQuery,
          treeId,
          MAX_RESULTS_PER_OTHER_TREE,
          MAX_OTHER_TREE_RESULTS,
        );
        if (isCurrentRequest()) setOtherTreeResults(results);
      } catch {
        if (isCurrentRequest()) setOtherTreeResults([]);
      } finally {
        if (isCurrentRequest()) setIsSearchingOtherTrees(false);
      }
    };

    if (!windowed || !treeId) {
      setServerResults([]);
      setIsSearchingCurrent(false);
      const timer = setTimeout(() => {
        void searchRemainingTrees();
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }

    setIsSearchingCurrent(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const results = await searchMembers(
            treeId,
            normalizedQuery,
            MAX_CURRENT_RESULTS,
          );
          if (isCurrentRequest()) setServerResults(results);
        } catch {
          if (isCurrentRequest()) setServerResults([]);
        } finally {
          if (isCurrentRequest()) setIsSearchingCurrent(false);
        }
        if (isCurrentRequest()) await searchRemainingTrees();
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchMembers, searchOtherTrees, treeId, windowed]);

  const currentResults: CurrentSearchMember[] = windowed
    ? serverResults
    : clientResults;
  const otherTreeGroups = useMemo(() => {
    const groups = new Map<string, OtherTreeGroup>();
    for (const member of otherTreeResults) {
      const existing = groups.get(member.treeId);
      if (existing) {
        existing.members.push(member);
      } else {
        groups.set(member.treeId, {
          treeId: member.treeId,
          treeName: member.treeName,
          members: [member],
        });
      }
    }
    return [...groups.values()];
  }, [otherTreeResults]);
  const selectableResults = useMemo<SearchResult[]>(
    () => [
      ...currentResults.map((member) => ({ kind: "current" as const, member })),
      ...otherTreeResults.map((member) => ({ kind: "other" as const, member })),
    ],
    [currentResults, otherTreeResults],
  );

  // Keep the active option in range whenever the result set changes.
  useEffect(() => setActiveIndex(0), [selectableResults]);

  // Close the dropdown when clicking outside the search box.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as globalThis.Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  const selectCurrent = (member: CurrentSearchMember) => {
    if (windowed) {
      onFocusRoot?.(member.id);
      setQuery("");
      setIsOpen(false);
      return;
    }
    onLocate(member as Member);
    setIsOpen(false);
  };

  const selectOtherTree = async (member: MemberSearchHitDB) => {
    try {
      await onOpenOtherTree(member.treeId, member.id);
      setQuery("");
      setIsOpen(false);
    } catch {
      toast.error(t("open-error"));
    }
  };

  const selectResult = (result: SearchResult) => {
    if (result.kind === "other") {
      void selectOtherTree(result.member);
      return;
    }
    selectCurrent(result.member);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (!selectableResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % selectableResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) =>
          (index - 1 + selectableResults.length) % selectableResults.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = selectableResults[activeIndex];
      if (result) selectResult(result);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  const showResults = isOpen && query.trim().length > 0;
  const hasOtherTreeSection =
    isSearchingOtherTrees || otherTreeGroups.length > 0;
  const hasNoResults =
    !isSearchingCurrent &&
    !isSearchingOtherTrees &&
    selectableResults.length === 0;

  const renderMemberResult = (
    member: CurrentSearchMember | MemberSearchHitDB,
    index: number,
    kind: SearchResult["kind"],
  ) => {
    const name = memberName(member) || t("unnamed");
    const sublabel = formatMemberSubLabel(
      member.maidenName,
      memberBirthDate(member),
      (maidenName) => t("nee", { name: maidenName }),
    );
    const isOtherTree = kind === "other";
    const treeName = isOtherTree ? (member as MemberSearchHitDB).treeName : "";

    return (
      <li
        key={
          isOtherTree
            ? `${(member as MemberSearchHitDB).treeId}:${member.id}`
            : member.id
        }
      >
        <button
          type="button"
          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
            index === activeIndex ? "bg-accent text-accent-foreground" : ""
          }`}
          onPointerEnter={() => setActiveIndex(index)}
          onClick={() =>
            selectResult(
              isOtherTree
                ? { kind: "other", member: member as MemberSearchHitDB }
                : { kind: "current", member: member as CurrentSearchMember },
            )
          }
          aria-label={
            isOtherTree
              ? t("open-other-tree", { tree: treeName, member: name })
              : undefined
          }
        >
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="font-medium">{name}</span>
            {sublabel && (
              <span className="text-xs text-muted-foreground">{sublabel}</span>
            )}
          </span>
          {isOtherTree && (
            <ArrowUpRight
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </button>
      </li>
    );
  };

  let otherTreeIndex = currentResults.length;

  return (
    <div ref={containerRef} className={cn("w-64", className)}>
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          placeholder={t("placeholder")}
          onChange={(event) => {
            setQuery(event.target.value);
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
        <ul className="mt-1 max-h-80 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {isSearchingCurrent ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("searching")}
            </li>
          ) : (
            currentResults.length > 0 && (
              <>
                {hasOtherTreeSection && (
                  <li className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {t("current-tree")}
                  </li>
                )}
                {currentResults.map((member, index) =>
                  renderMemberResult(member, index, "current"),
                )}
              </>
            )
          )}

          {hasOtherTreeSection && (
            <li className="border-t">
              <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                {t("other-trees")}
              </div>
              {isSearchingOtherTrees ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t("other-trees-searching")}
                </div>
              ) : (
                <ul>
                  {otherTreeGroups.map((group) => (
                    <li key={group.treeId}>
                      <div className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
                        {group.treeName}
                      </div>
                      <ul>
                        {group.members.map((member) => {
                          const index = otherTreeIndex;
                          otherTreeIndex += 1;
                          return renderMemberResult(member, index, "other");
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}

          {hasNoResults && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("no-results")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
