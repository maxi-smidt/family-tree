import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { SavedViewDB } from "@/types/savedView";
import { ApiError } from "@/services/api";

const MAX_DEPTH = 20;

interface SavedViewFormDialogProps {
  open: boolean;
  /** null creates a new view; otherwise edits this one. */
  view: SavedViewDB | null;
  /** Seeds a new view from the canvas's current focus/scope (#1013's "create
   *  from the current canvas") — ignored once editing an existing view. */
  initialFocusMemberId?: string | null;
  initialSectionIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSaved?: (view: SavedViewDB, wasCreate: boolean) => void;
}

const clampDepth = (value: number) =>
  Math.min(MAX_DEPTH, Math.max(0, Math.trunc(value) || 0));

export const SavedViewFormDialog = ({
  open,
  view,
  initialFocusMemberId = null,
  initialSectionIds = [],
  onOpenChange,
  onSaved,
}: SavedViewFormDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.saved-view-form",
  });
  const members = useMemberStore((s) => s.members);
  const sections = useSectionStore((s) => s.sections);
  const createSavedView = useSavedViewStore((s) => s.createSavedView);
  const updateSavedView = useSavedViewStore((s) => s.updateSavedView);

  const [name, setName] = useState("");
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null);
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [ancestorDepth, setAncestorDepth] = useState(3);
  const [descendantDepth, setDescendantDepth] = useState(3);
  const [includePartners, setIncludePartners] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (view) {
      setName(view.name);
      setFocusMemberId(view.focus_member_id);
      setSectionIds(new Set(view.section_ids));
      setAncestorDepth(view.ancestor_depth);
      setDescendantDepth(view.descendant_depth);
      setIncludePartners(view.include_partners);
    } else {
      setName("");
      setFocusMemberId(initialFocusMemberId);
      setSectionIds(new Set(initialSectionIds));
      setAncestorDepth(3);
      setDescendantDepth(3);
      setIncludePartners(true);
    }
    setError(null);
    // Only re-seed on open/target change; the form owns its fields afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  const toggleSection = (sectionId: string, checked: boolean) => {
    setSectionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = view
        ? await updateSavedView(view.id, {
            name: trimmed,
            focus_member_id: focusMemberId ?? undefined,
            clear_focus_member: focusMemberId === null,
            section_ids: [...sectionIds],
            ancestor_depth: ancestorDepth,
            descendant_depth: descendantDepth,
            include_partners: includePartners,
            expected_version: view.version,
          })
        : await createSavedView({
            name: trimmed,
            focus_member_id: focusMemberId,
            section_ids: [...sectionIds],
            ancestor_depth: ancestorDepth,
            descendant_depth: descendantDepth,
            include_partners: includePartners,
          });
      onOpenChange(false);
      onSaved?.(saved, view === null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("stale-conflict"));
      } else {
        setError(view ? t("edit-error") : t("create-error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {view ? t("title-edit") : t("title-create")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="saved-view-name">{t("name-label")}</Label>
            <Input
              id="saved-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("focus-label")}</Label>
            <MemberPicker
              members={members}
              value={focusMemberId}
              onChange={setFocusMemberId}
              placeholder={t("focus-placeholder")}
              noResultsText={t("focus-no-results")}
              size="default"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("sections-label")}</Label>
            {sections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("no-sections")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sections.map((section) => (
                  <li
                    key={section.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {section.name}
                    </span>
                    <Switch
                      checked={sectionIds.has(section.id)}
                      onCheckedChange={(checked) =>
                        toggleSection(section.id, checked)
                      }
                      aria-label={section.name}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="saved-view-ancestor-depth">
                {t("ancestor-depth-label")}
              </Label>
              <Input
                id="saved-view-ancestor-depth"
                type="number"
                min={0}
                max={MAX_DEPTH}
                value={ancestorDepth}
                onChange={(e) =>
                  setAncestorDepth(clampDepth(Number(e.target.value)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="saved-view-descendant-depth">
                {t("descendant-depth-label")}
              </Label>
              <Input
                id="saved-view-descendant-depth"
                type="number"
                min={0}
                max={MAX_DEPTH}
                value={descendantDepth}
                onChange={(e) =>
                  setDescendantDepth(clampDepth(Number(e.target.value)))
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="saved-view-include-partners">
              {t("include-partners-label")}
            </Label>
            <Switch
              id="saved-view-include-partners"
              checked={includePartners}
              onCheckedChange={setIncludePartners}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || submitting}
          >
            {view ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
