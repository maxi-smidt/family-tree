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
import { useTreeStore } from "@/hooks/useTreeStore";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { useTreeManager } from "@/hooks/useTreeManager";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/services/api";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const RemoveDatabaseDialog = ({
  isOpen,
  onConfirm,
  onCancel,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.remove-database",
  });
  const trees = useTreeStore((s) => s.trees);
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const selectTree = useTreeStore((s) => s.selectTree);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const { removeDatabase } = useTreeManager();
  const [typedName, setTypedName] = useState("");

  if (!selectedTree) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancellation()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: selectedTree.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 px-1">
          <div className="space-y-2">
            <FieldLabel htmlFor="databaseName">{t("name")}</FieldLabel>
            <Input
              id="databaseName"
              placeholder={selectedTree.name}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancellation}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirmation}
            disabled={typedName !== selectedTree.name}
          >
            {t("remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function onCancellation() {
    resetState();
    onCancel();
  }
  async function onConfirmation() {
    if (typedName !== selectedTree?.name) return;
    const toRemove = selectedTree;
    const nextDatabase = trees.find((db) => db.id !== toRemove.id);

    if (!nextDatabase) {
      toast.warning(t("toast-warning"));
    }
    await selectTree(nextDatabase);
    try {
      await removeDatabase(toRemove);
      resetState();
      toast.success(t("toast-success"));
      onConfirm();
    } catch (err) {
      console.error(err);
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.status === 403)
      ) {
        toast.error(t("toast-permission-error"));
        await loadTrees();
        resetState();
        onConfirm();
        return;
      }
      toast.error(t("toast-error"));
    }
  }

  function resetState() {
    setTypedName("");
  }
};
