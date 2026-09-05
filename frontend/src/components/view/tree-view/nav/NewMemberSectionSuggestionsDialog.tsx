import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SectionSuggestionDB } from "@/types/section";
import { useMemberStore } from "@/hooks/useMemberStore";
import { getMemberFullName } from "@/utils/memberUtils";

interface NewMemberSectionSuggestionsDialogProps {
  memberName: string;
  suggestions: SectionSuggestionDB[] | null;
  onConfirm: (sectionIds: string[]) => Promise<void> | void;
  onSkip: () => void;
}

/** Confirmation for new-member section suggestions (#990): a new member's
 *  parents/partner may already belong to sections, but they are never added
 *  silently — the user picks which ones, if any, and can always leave the
 *  member unassigned. */
export const NewMemberSectionSuggestionsDialog = ({
  memberName,
  suggestions,
  onConfirm,
  onSkip,
}: NewMemberSectionSuggestionsDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.new-member-suggestions",
  });
  const members = useMemberStore((s) => s.members);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setSelected(new Set());
  }, [suggestions]);

  const toggle = (sectionId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm([...selected]);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog
      open={suggestions !== null}
      onOpenChange={(open) => !open && onSkip()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { name: memberName })}</DialogTitle>
          <DialogDescription>
            {t("description", { name: memberName })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {(suggestions ?? []).map(({ section, matched_via_member_ids }) => {
            const names = matched_via_member_ids
              .map((id) => {
                const m = members.find((member) => member.id === id);
                return m ? getMemberFullName(m) : null;
              })
              .filter((name): name is string => Boolean(name))
              .join(", ");
            return (
              <li
                key={section.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{section.name}</span>
                    <Badge variant="secondary">{section.member_count}</Badge>
                  </div>
                  {names && (
                    <p className="truncate text-xs text-muted-foreground">
                      {t("matched-via", { names })}
                    </p>
                  )}
                </div>
                <Switch
                  checked={selected.has(section.id)}
                  onCheckedChange={(checked) => toggle(section.id, checked)}
                  aria-label={section.name}
                />
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onSkip}>
            {t("skip")}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={confirming}
          >
            {confirming ? t("confirming") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
