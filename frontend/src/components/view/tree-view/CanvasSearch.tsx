import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Member } from "@/types/member";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;

interface CanvasSearchProps {
  members: Member[];
  onLocate: (member: Member) => void;
  className?: string;
}

/**
 * Search box rendered on the tree canvas. Filters members by first/last/maiden
 * name and, on select, asks the parent to pan/zoom to and highlight the node.
 */
export const CanvasSearch = ({
  members,
  onLocate,
  className,
}: CanvasSearchProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.search" });
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
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
  }, [members, query]);

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

  const select = (member: Member) => {
    onLocate(member);
    setIsOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keep canvas key handlers (delete, arrow-pan) from reacting while typing.
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
      const member = results[activeIndex];
      if (member) select(member);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const showResults = isOpen && query.trim().length > 0;

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
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("no-results")}
            </li>
          ) : (
            results.map((member, index) => (
              <li key={member.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => select(member)}
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
