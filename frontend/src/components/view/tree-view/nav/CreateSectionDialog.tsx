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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { TreePreview } from "@/components/shared/TreePreview";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { SectionDirection, SectionPreviewDB } from "@/types/section";
import { ApiError } from "@/services/api";
import {
  previewSectionMembers,
  previewSectionBoundaryMembers,
} from "@/utils/treePreview";

type CreateSectionDirection = Exclude<SectionDirection, "partnership">;

interface CreateSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects the seed person — e.g. when opened from a canvas selection
   *  rather than the workspace nav panel's generic "+" (#990). */
  initialRootMemberId?: string | null;
}

export const CreateSectionDialog = ({
  open,
  onOpenChange,
  initialRootMemberId = null,
}: CreateSectionDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.create-section",
  });
  // The picker only offers members already resident on the canvas — good
  // enough for a seed pick, and consistent with how a windowed tree exposes
  // members elsewhere in the tree-view UI.
  const members = useMemberStore((s) => s.members);
  const createSection = useSectionStore((s) => s.createSection);
  const previewSection = useSectionStore((s) => s.previewSection);
  const sections = useSectionStore((s) => s.sections);

  const [name, setName] = useState("");
  const [rootMemberId, setRootMemberId] = useState<string | null>(
    initialRootMemberId,
  );
  const [direction, setDirection] =
    useState<CreateSectionDirection>("direct_family");
  const [preview, setPreview] = useState<SectionPreviewDB | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRootMemberId(initialRootMemberId);
      return;
    }
    setName("");
    setRootMemberId(null);
    setDirection("direct_family");
    setPreview(null);
    setError(null);
    // Only re-seed from the trigger on open; the picker owns it afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !rootMemberId) {
      setPreview(null);
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setPreview(null);
    setLoadingPreview(true);
    previewSection(rootMemberId, direction)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootMemberId, direction, previewSection]);

  const previewIncluded = useMemo(
    () => previewSectionMembers(direction),
    [direction],
  );
  const previewBoundary = useMemo(
    () => previewSectionBoundaryMembers(previewIncluded),
    [previewIncluded],
  );
  const directionHint = {
    extended_family: t("direction-extended-family-hint"),
    lineage: t("direction-lineage-hint"),
    direct_family: t("direction-direct-family-hint"),
  }[direction];

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSection({
        name: trimmed,
        root_member_id: rootMemberId ?? undefined,
        direction,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("name-conflict")
          : t("create-error"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-5">
          <div className="space-y-1.5">
            <Label htmlFor="new-section-name">{t("name-label")}</Label>
            <Input
              id="new-section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("seed-label")}</Label>
            <MemberPicker
              members={members}
              value={rootMemberId}
              onChange={setRootMemberId}
              placeholder={t("seed-placeholder")}
              noResultsText={t("seed-no-results")}
              size="default"
            />
          </div>
          {rootMemberId && (
            <div className="space-y-1.5">
              <Label htmlFor="new-section-direction">
                {t("direction-label")}
              </Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as CreateSectionDirection)}
              >
                <SelectTrigger
                  id="new-section-direction"
                  className="w-full min-w-0"
                  aria-describedby="new-section-direction-hint"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]"
                >
                  <SelectItem value="extended_family">
                    {t("direction-extended-family")}
                  </SelectItem>
                  <SelectItem value="lineage">
                    {t("direction-lineage")}
                  </SelectItem>
                  <SelectItem value="direct_family">
                    {t("direction-direct-family")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p
                id="new-section-direction-hint"
                className="text-xs text-muted-foreground"
              >
                {directionHint}
              </p>
            </div>
          )}
          {rootMemberId && (
            <TreePreview
              variant="section"
              included={previewIncluded}
              boundary={previewBoundary}
            />
          )}
          {rootMemberId && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {loadingPreview && t("preview-loading")}
              {!loadingPreview && preview && (
                <>
                  <p>
                    {t("preview-member-count", {
                      count: preview.primary_member_ids.length,
                    })}
                  </p>
                  {preview.boundary_member_ids.length > 0 && (
                    <p>
                      {t("preview-boundary-count", {
                        count: preview.boundary_member_ids.length,
                      })}
                    </p>
                  )}
                  {preview.overlaps.length > 0 && (
                    <ul className="mt-1 ml-4 list-disc">
                      {preview.overlaps.map((overlap) => {
                        // Effective permissions: an overlap with a section
                        // already loaded in the nav panel tells us whether
                        // this caller could also edit it — a section-scoped
                        // editor may only be able to read some overlaps.
                        const known = sections.find(
                          (s) => s.id === overlap.section_id,
                        );
                        return (
                          <li key={overlap.section_id}>
                            {t("preview-overlap", {
                              name: overlap.section_name,
                              count: overlap.member_count,
                            })}
                            {known && !known.can_write && (
                              <> ({t("preview-overlap-read-only")})</>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
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
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
