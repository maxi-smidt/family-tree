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
import { useTreeStore } from "@/hooks/useTreeStore";
import { TreeService } from "@/services/TreeService";
import { ApiError } from "@/services/api";
import { Tree } from "@/types/tree";
import { mapMemberFromDB, MemberDB } from "@/types/member";
import { MemberPicker } from "./MemberPicker";

type Mode = "existing" | "create";

interface Props {
  memberId: string;
  memberName: string;
  tree: Tree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

/**
 * Resolves a tree-in-tree bridge person against an already-existing target
 * tree, opened from `LinkedTreeField` when the user picks a tree from the
 * dropdown. The member must already be saved (bridging writes rows in two
 * trees) and the caller must have write access to the target — both are
 * enforced by the backend, but the no-access case is also short-circuited
 * here from `tree.role` for a friendlier state. The source tree itself is
 * resolved by `linkExistingTree` from the currently selected tree.
 */
export const LinkExistingTreeDialog = ({
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
  const linkExistingTree = useTreeStore((s) => s.linkExistingTree);

  const [mode, setMode] = useState<Mode>("existing");
  const [candidates, setCandidates] = useState<MemberDB[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasWriteAccess = tree.role === "owner" || tree.role === "editor";

  useEffect(() => {
    if (!open || !hasWriteAccess) return;
    setMode("existing");
    setSelectedId(null);
    setLoading(true);
    TreeService.getMembers(tree.id, true)
      .then((rows) => setCandidates(rows))
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [open, hasWriteAccess, tree.id]);

  // Members that already have a bridge to somewhere cannot be re-used as a
  // counterpart (would hijack the other link's bridge).
  const pickableMembers = candidates
    .filter((m) => !m.linkedTreeId)
    .map((m) => mapMemberFromDB(m));

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await linkExistingTree(memberId, {
        linked_tree_id: tree.id,
        mode,
        counterpart_member_id: mode === "existing" ? selectedId : undefined,
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
      <DialogContent>
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
              <MemberPicker
                members={pickableMembers}
                value={selectedId}
                onChange={setSelectedId}
                placeholder={loading ? t("loading") : t("existing-placeholder")}
                noResultsText={
                  loading ? t("loading") : t("existing-no-results")
                }
                showBirthDate
                size="default"
              />
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
                submitting || (mode === "existing" && selectedId === null)
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
