import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { ApiError } from "@/services/api";
import { Workspace } from "@/types/workspace";
import { DuplicatePair } from "@/types/merge";
import {
  PairResolutionState,
  buildInitialResolutionState,
  memberDisplayName,
} from "@/utils/mergeUtils";
import { MergeConflictResolver } from "@/components/view/database-management-view/dialog/MergeConflictResolver";

type Mode = "existing" | "create";

interface Props {
  /** Id of the tree the member being linked currently lives in (the source
   *  side of the bridge, "A" in every conflict). */
  sourceWorkspaceId: string;
  memberId: string;
  memberName: string;
  tree: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

/**
 * Resolves a tree-in-tree bridge person against an already-existing target
 * tree, opened from `LinkedTreeField` when the user picks a tree from the
 * dropdown. The member must already be saved (bridging writes rows in two
 * workspaces) and the caller must have write access to the target — both are
 * enforced by the backend, but the no-access case is also short-circuited
 * here from `tree.role` for a friendlier state.
 *
 * In "find existing person" mode, only same-named candidates from the
 * merge/duplicate-detection machinery are offered (#565 follow-up) — picking
 * one that conflicts on some fields opens the same `MergeConflictResolver`
 * used by tree merge, so differences are resolved instead of left to drift.
 */
export const LinkExistingTreeDialog = ({
  sourceWorkspaceId,
  memberId,
  memberName,
  tree,
  open,
  onOpenChange,
  onLinked,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode.linked-tree.link-dialog",
  });
  const linkExistingTree = useWorkspaceStore((s) => s.linkExistingTree);

  const [mode, setMode] = useState<Mode>("existing");
  const [candidates, setCandidates] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionState, setResolutionState] =
    useState<PairResolutionState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasWriteAccess = tree.role === "owner" || tree.role === "editor";

  useEffect(() => {
    if (!open || !hasWriteAccess) return;
    setMode("existing");
    setSelectedId(null);
    setResolutionState(null);
    setLoading(true);
    WorkspaceService.getLinkCandidates(sourceWorkspaceId, memberId, tree.id)
      .then((res) => setCandidates(res.candidates))
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [open, hasWriteAccess, sourceWorkspaceId, memberId, tree.id]);

  const selectedPair =
    candidates.find((c) => c.member_b.id === selectedId) ?? null;

  const handleSelectCandidate = (id: string) => {
    setSelectedId(id);
    const pair = candidates.find((c) => c.member_b.id === id);
    setResolutionState(pair ? buildInitialResolutionState(pair) : null);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await linkExistingTree(memberId, {
        linked_workspace_id: tree.id,
        mode,
        counterpart_member_id: mode === "existing" ? selectedId : undefined,
        field_choices:
          mode === "existing" && resolutionState
            ? resolutionState.fields
            : undefined,
      });
      toast.success(t("toast-success", { name: tree.name }));
      onLinked();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("toast-error-already-linked"));
      } else if (err instanceof ApiError && err.status === 403) {
        toast.error(t("toast-error-no-access"));
      } else {
        toast.error(t("toast-error-generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title", { name: tree.name })}</DialogTitle>
          <DialogDescription>
            {t("description", { member: memberName, tree: tree.name })}
          </DialogDescription>
        </DialogHeader>

        {!hasWriteAccess ? (
          <p className="text-sm text-muted-foreground">
            {t("no-access", { tree: tree.name })}
          </p>
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="existing" className="flex-1">
                {t("mode-existing")}
              </TabsTrigger>
              <TabsTrigger value="create" className="flex-1">
                {t("mode-create")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="existing" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("mode-existing-description")}
              </p>
              {!loading && candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("no-candidates", { member: memberName, tree: tree.name })}
                </p>
              ) : (
                <Select
                  value={selectedId ?? undefined}
                  onValueChange={handleSelectCandidate}
                  disabled={loading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        loading ? t("loading") : t("existing-placeholder")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.member_b.id} value={c.member_b.id}>
                        {memberDisplayName(c.member_b)}
                        {c.member_b.dateOfBirth
                          ? ` (${c.member_b.dateOfBirth})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedPair && selectedPair.conflicts.length > 0 && (
                <div className="pt-2">
                  <MergeConflictResolver
                    pair={selectedPair}
                    sourceAName={memberName}
                    sourceBName={tree.name}
                    state={
                      resolutionState ??
                      buildInitialResolutionState(selectedPair)
                    }
                    onChange={(updated) =>
                      setResolutionState({ ...updated, action: "merge" })
                    }
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="create" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("mode-create-description", {
                  member: memberName,
                  tree: tree.name,
                })}
              </p>
            </TabsContent>
          </Tabs>
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
          {hasWriteAccess && (
            <Button
              type="button"
              size="sm"
              disabled={
                submitting ||
                (mode === "existing" &&
                  (selectedId === null || candidates.length === 0))
              }
              onClick={() => void handleConfirm()}
            >
              {t("confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
