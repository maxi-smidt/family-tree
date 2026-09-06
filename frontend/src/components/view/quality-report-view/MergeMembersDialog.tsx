import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { ApiError } from "@/services/api";
import { MemberMergePreview } from "@/types/merge";
import {
  PairResolutionState,
  buildInitialResolutionState,
} from "@/utils/mergeUtils";
import { MergeConflictResolver } from "@/components/view/database-management-view/dialog/MergeConflictResolver";

interface Props {
  /** The finding's member_ids — length >= 2; the first two are preselected. */
  memberIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}

const TRANSFER_KEYS: (keyof MemberMergePreview["transfer"])[] = [
  "relations",
  "events",
  "stories",
  "gallery",
  "documents",
  "tasks",
  "diseases",
];

export const MergeMembersDialog = ({
  memberIds,
  open,
  onOpenChange,
  onMerged,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "merge-members-dialog",
  });
  const { members } = useMemberStore();
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const mergeMembers = useQualityReportStore((s) => s.mergeMembers);

  const [keepId, setKeepId] = useState(memberIds[0]);
  const [removeId, setRemoveId] = useState(memberIds[1]);
  const [preview, setPreview] = useState<MemberMergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [resolutionState, setResolutionState] =
    useState<PairResolutionState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKeepId(memberIds[0]);
    setRemoveId(memberIds[1]);
  }, [open, memberIds]);

  useEffect(() => {
    if (!open || !workspaceId || !keepId || !removeId || keepId === removeId) {
      setPreview(null);
      setPreviewError(false);
      setResolutionState(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(false);
    WorkspaceService.getMemberMergePreview(workspaceId, keepId, removeId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setResolutionState(buildInitialResolutionState(result.pair));
      })
      .catch(() => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, keepId, removeId]);

  const nameFor = (id: string) => {
    const member = members.find((m) => m.id === id);
    if (!member) return id;
    return [member.firstName, member.lastName].filter(Boolean).join(" ") || id;
  };

  const transferRows = useMemo(
    () =>
      TRANSFER_KEYS.map((key) => ({
        key,
        count: preview?.transfer[key] ?? 0,
      })).filter((row) => row.count > 0),
    [preview],
  );

  const handleSwap = () => {
    setKeepId(removeId);
    setRemoveId(keepId);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await mergeMembers(keepId, removeId, resolutionState?.fields ?? {});
      toast.success(t("success"));
      onMerged();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        toast.error(t("cycle-error"));
      } else {
        toast.error(t("error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const distinct = keepId !== removeId;
  const otherCandidates = (excludeId: string) =>
    memberIds.filter((id) => id !== excludeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {memberIds.length > 2 ? (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t("primary-label")}</Label>
              <Select value={keepId} onValueChange={setKeepId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherCandidates(removeId).map((id) => (
                    <SelectItem key={id} value={id}>
                      {nameFor(id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5"
              onClick={handleSwap}
              title={t("swap")}
            >
              <ArrowLeftRight className="w-4 h-4" />
            </Button>
            <div className="space-y-1">
              <Label className="text-xs">{t("duplicate-label")}</Label>
              <Select value={removeId} onValueChange={setRemoveId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherCandidates(keepId).map((id) => (
                    <SelectItem key={id} value={id}>
                      {nameFor(id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <div className="text-center">
              <div className="text-xs text-muted-foreground">
                {t("primary-label")}
              </div>
              <div className="text-sm font-medium">{nameFor(keepId)}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleSwap}
              title={t("swap")}
            >
              <ArrowLeftRight className="w-4 h-4" />
            </Button>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">
                {t("duplicate-label")}
              </div>
              <div className="text-sm font-medium">{nameFor(removeId)}</div>
            </div>
          </div>
        )}

        {!distinct && (
          <p className="text-sm text-destructive text-center">
            {t("same-member-error")}
          </p>
        )}

        {distinct && loadingPreview && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("loading-preview")}
          </p>
        )}

        {distinct && !loadingPreview && previewError && (
          <p className="text-sm text-destructive text-center py-4">
            {t("preview-error")}
          </p>
        )}

        {distinct && !loadingPreview && preview && resolutionState && (
          <div className="space-y-3">
            {preview.would_create_cycle && (
              <p className="text-sm text-destructive">{t("cycle-error")}</p>
            )}
            {preview.pair.conflicts.length > 0 && (
              <MergeConflictResolver
                pair={preview.pair}
                sourceAName={nameFor(keepId)}
                sourceBName={nameFor(removeId)}
                state={resolutionState}
                onChange={setResolutionState}
                hideActionToggle
              />
            )}
            {transferRows.length > 0 && (
              <div className="border rounded-md p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {t("transfer-title")}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {transferRows.map((row) => (
                    <span key={row.key} className="text-sm">
                      {t(`transfer-${row.key}`, { count: row.count })}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              !distinct ||
              submitting ||
              loadingPreview ||
              !preview ||
              preview.would_create_cycle
            }
            onClick={() => void handleConfirm()}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
