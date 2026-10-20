import { useEffect, useMemo, useState } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TreePreview } from "@/components/shared/TreePreview";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import {
  ALL_GENERATIONS,
  MAX_SAVED_VIEW_DEPTH,
  SavedViewDB,
  isAllGenerations,
} from "@/types/savedView";
import { ApiError } from "@/services/api";
import {
  PREVIEW_NODES,
  PREVIEW_SECTION_IDS,
  previewViewMembers,
} from "@/utils/treePreview";

const DEFAULT_DEPTH = 3;

type Scope = "workspace" | "sections";

/** One direction's depth: a bounded count, or all the way. The count is
 *  kept while "all" is on so switching it off restores the last value. */
interface DepthSetting {
  count: number;
  all: boolean;
}

const depthFrom = (depth: number): DepthSetting =>
  isAllGenerations(depth)
    ? { count: DEFAULT_DEPTH, all: true }
    : { count: depth, all: false };

const depthValue = (d: DepthSetting) => (d.all ? ALL_GENERATIONS : d.count);

// The dummy nodes a section-scoped preview leaves out entirely.
const PREVIEW_OUTSIDE_SECTIONS = new Set(
  PREVIEW_NODES.map((n) => n.id).filter((id) => !PREVIEW_SECTION_IDS.has(id)),
);

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
  Math.min(MAX_SAVED_VIEW_DEPTH, Math.max(0, Math.trunc(value) || 0));

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
  const refreshSavedViews = useSavedViewStore((s) => s.refreshSavedViews);

  const [name, setName] = useState("");
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("workspace");
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [ancestorDepth, setAncestorDepth] = useState<DepthSetting>(
    depthFrom(DEFAULT_DEPTH),
  );
  const [descendantDepth, setDescendantDepth] = useState<DepthSetting>(
    depthFrom(DEFAULT_DEPTH),
  );
  const [includePartners, setIncludePartners] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (view) {
      setName(view.name);
      setFocusMemberId(view.focus_member_id);
      setScope(view.section_ids.length ? "sections" : "workspace");
      setSectionIds(new Set(view.section_ids));
      setAncestorDepth(depthFrom(view.ancestor_depth));
      setDescendantDepth(depthFrom(view.descendant_depth));
      setIncludePartners(view.include_partners);
    } else {
      setName("");
      setFocusMemberId(initialFocusMemberId);
      setScope(initialSectionIds.length ? "sections" : "workspace");
      setSectionIds(new Set(initialSectionIds));
      setAncestorDepth(depthFrom(DEFAULT_DEPTH));
      setDescendantDepth(depthFrom(DEFAULT_DEPTH));
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

  const sectionScoped = scope === "sections";
  // A section scope with nothing picked would silently mean "everything".
  const missingSections = sectionScoped && sectionIds.size === 0;
  const chosenSectionIds = sectionScoped ? [...sectionIds] : [];

  const previewIncluded = useMemo(
    () =>
      previewViewMembers({
        up: ancestorDepth.all ? Infinity : ancestorDepth.count,
        down: descendantDepth.all ? Infinity : descendantDepth.count,
        includePartners,
        sectionScoped,
      }),
    [ancestorDepth, descendantDepth, includePartners, sectionScoped],
  );

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || missingSections) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = view
        ? await updateSavedView(view.id, {
            name: trimmed,
            focus_member_id: focusMemberId ?? undefined,
            clear_focus_member: focusMemberId === null,
            section_ids: chosenSectionIds,
            ancestor_depth: depthValue(ancestorDepth),
            descendant_depth: depthValue(descendantDepth),
            include_partners: includePartners,
            expected_version: view.version,
          })
        : await createSavedView({
            name: trimmed,
            focus_member_id: focusMemberId,
            section_ids: chosenSectionIds,
            ancestor_depth: depthValue(ancestorDepth),
            descendant_depth: depthValue(descendantDepth),
            include_partners: includePartners,
          });
      onOpenChange(false);
      onSaved?.(saved, view === null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("stale-conflict"));
        // The message promises the reopened dialog will show the latest
        // version — refresh the list now so a later "Edit" picks it up.
        void refreshSavedViews();
      } else {
        setError(view ? t("edit-error") : t("create-error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
            <Label>{t("scope-label")}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={scope}
              onValueChange={(value) => value && setScope(value as Scope)}
              className="w-full"
            >
              <ToggleGroupItem value="workspace" className="flex-1">
                {t("scope-workspace")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sections"
                className="flex-1"
                disabled={sections.length === 0}
              >
                {t("scope-sections")}
              </ToggleGroupItem>
            </ToggleGroup>
            {sections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("no-sections")}
              </p>
            ) : (
              sectionScoped && (
                <>
                  <ul className="space-y-1.5" aria-label={t("sections-label")}>
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
                  {missingSections && (
                    <p className="text-xs text-muted-foreground">
                      {t("sections-required")}
                    </p>
                  )}
                </>
              )
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DepthField
              id="saved-view-ancestor-depth"
              label={t("ancestor-depth-label")}
              allLabel={t("all-ancestors")}
              value={ancestorDepth}
              onChange={setAncestorDepth}
            />
            <DepthField
              id="saved-view-descendant-depth"
              label={t("descendant-depth-label")}
              allLabel={t("all-descendants")}
              value={descendantDepth}
              onChange={setDescendantDepth}
            />
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
          <TreePreview
            variant="view"
            included={previewIncluded}
            outside={sectionScoped ? PREVIEW_OUTSIDE_SECTIONS : undefined}
          />
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
            shortcut="save"
            disabled={!name.trim() || missingSections || submitting}
          >
            {view ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface DepthFieldProps {
  id: string;
  label: string;
  allLabel: string;
  value: DepthSetting;
  onChange: (value: DepthSetting) => void;
}

const DepthField = ({
  id,
  label,
  allLabel,
  value,
  onChange,
}: DepthFieldProps) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="number"
      min={0}
      max={MAX_SAVED_VIEW_DEPTH}
      value={value.count}
      disabled={value.all}
      onChange={(e) =>
        onChange({ ...value, count: clampDepth(Number(e.target.value)) })
      }
    />
    <div className="flex items-center gap-2">
      <Switch
        id={`${id}-all`}
        size="sm"
        checked={value.all}
        onCheckedChange={(all) => onChange({ ...value, all })}
      />
      <Label htmlFor={`${id}-all`} className="text-xs font-normal">
        {allLabel}
      </Label>
    </div>
  </div>
);
