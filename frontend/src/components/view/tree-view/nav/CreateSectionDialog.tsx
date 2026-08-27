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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { SectionPreviewDB } from "@/types/section";
import { ApiError } from "@/services/api";

type Direction = "direct_family" | "partnership";

interface CreateSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CreateSectionDialog = ({
  open,
  onOpenChange,
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

  const [name, setName] = useState("");
  const [rootMemberId, setRootMemberId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("direct_family");
  const [preview, setPreview] = useState<SectionPreviewDB | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setName("");
    setRootMemberId(null);
    setDirection("direct_family");
    setPreview(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!rootMemberId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
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
  }, [rootMemberId, direction, previewSection]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
              <Label>{t("direction-label")}</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as Direction)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_family">
                    {t("direction-direct-family")}
                  </SelectItem>
                  <SelectItem value="partnership">
                    {t("direction-partnership")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {rootMemberId && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {loadingPreview && t("preview-loading")}
              {!loadingPreview && preview && (
                <>
                  {t("preview-summary", {
                    primary: preview.primary_member_ids.length,
                    boundary: preview.boundary_member_ids.length,
                  })}
                  {preview.overlaps.length > 0 && (
                    <ul className="mt-1 ml-4 list-disc">
                      {preview.overlaps.map((overlap) => (
                        <li key={overlap.section_id}>
                          {t("preview-overlap", {
                            name: overlap.section_name,
                            count: overlap.member_count,
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
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
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
