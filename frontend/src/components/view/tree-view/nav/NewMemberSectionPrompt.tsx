import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionSuggestionDB } from "@/types/section";
import { useMemberStore } from "@/hooks/useMemberStore";
import { getMemberFullName } from "@/utils/memberUtils";

/** How long the prompt stays up without interaction. */
export const SECTION_PROMPT_DURATION_MS = 10_000;
const TICK_MS = 100;
/** Grace period after the last section was answered, so the "Added" mark
 *  is seen before the prompt closes. */
const DONE_LINGER_MS = 1_200;

interface NewMemberSectionPromptProps {
  memberName: string;
  suggestions: SectionSuggestionDB[] | null;
  onAdd: (sectionId: string) => Promise<void>;
  onDismiss: () => void;
}

/** Short-lived prompt for new-member section suggestions (#990): a new
 *  member's parents/partner may already belong to sections, but they are
 *  never added silently. Each section is answered on its own; the prompt
 *  closes by itself after a few seconds (paused while hovered or focused),
 *  and anything not added by then stays unassigned. */
export const NewMemberSectionPrompt = ({
  memberName,
  suggestions,
  onAdd,
  onDismiss,
}: NewMemberSectionPromptProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.new-member-suggestions",
  });
  const members = useMemberStore((s) => s.members);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(SECTION_PROMPT_DURATION_MS);

  useEffect(() => {
    setAdded(new Set());
    setAdding(new Set());
    setRemaining(SECTION_PROMPT_DURATION_MS);
  }, [suggestions]);

  const open = suggestions !== null && suggestions.length > 0;
  const paused = hovered || adding.size > 0;

  useEffect(() => {
    if (!open || paused) return;
    const id = setInterval(() => {
      // Keyboard focus inside the prompt pauses it too. Checked per tick
      // rather than via blur, which doesn't fire when the focused button
      // is replaced by its "Added" mark.
      if (containerRef.current?.contains(document.activeElement)) return;
      setRemaining((r) => Math.max(0, r - TICK_MS));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [open, paused]);

  useEffect(() => {
    if (open && remaining <= 0) onDismiss();
  }, [open, remaining, onDismiss]);

  if (!open) return null;

  const writable = suggestions.filter((s) => s.section.can_write);

  const handleAdd = async (sectionId: string) => {
    setAdding((prev) => new Set(prev).add(sectionId));
    try {
      await onAdd(sectionId);
      const next = new Set(added).add(sectionId);
      setAdded(next);
      if (writable.every((s) => next.has(s.section.id))) {
        setRemaining((r) => Math.min(r, DONE_LINGER_MS));
      }
    } catch {
      // The caller reports the error; the row stays unanswered.
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(sectionId);
        return next;
      });
    }
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] shadow-lg"
      role="region"
      aria-live="polite"
      aria-label={t("title", { name: memberName })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={containerRef}
    >
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-start justify-between gap-2 px-4 pt-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {t("title", { name: memberName })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("description", { name: memberName })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDismiss}
            aria-label={t("skip")}
          >
            <X className="size-3" />
          </Button>
        </div>
        <ul className="space-y-2 px-4 py-3">
          {suggestions.map(({ section, matched_via_member_ids }) => {
            const names = matched_via_member_ids
              .map((id) => {
                const m = members.find((member) => member.id === id);
                return m ? getMemberFullName(m) : null;
              })
              .filter((name): name is string => Boolean(name))
              .join(", ");
            const isAdded = added.has(section.id);
            return (
              <li
                key={section.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {section.name}
                    </span>
                    <Badge variant="secondary">{section.member_count}</Badge>
                  </div>
                  {names && (
                    <p className="truncate text-xs text-muted-foreground">
                      {t("matched-via", { names })}
                    </p>
                  )}
                  {!section.can_write && (
                    <p className="truncate text-xs text-muted-foreground">
                      {t("read-only")}
                    </p>
                  )}
                </div>
                {isAdded ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3" />
                    {t("added")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void handleAdd(section.id)}
                    disabled={!section.can_write || adding.has(section.id)}
                    aria-label={t("add-to", { section: section.name })}
                  >
                    {adding.has(section.id) ? t("confirming") : t("add")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-linear"
            style={{
              width: `${(remaining / SECTION_PROMPT_DURATION_MS) * 100}%`,
            }}
            data-testid="section-prompt-countdown"
          />
        </div>
      </Card>
    </div>
  );
};
