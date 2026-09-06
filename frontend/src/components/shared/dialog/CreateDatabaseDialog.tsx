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
import { FieldLabel } from "@/components/ui/field";
import { useState } from "react";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disableCancel?: boolean;
};

export const CreateDatabaseDialog = ({
  isOpen,
  onConfirm,
  onCancel,
  disableCancel = false,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.create-database",
  });
  const [databaseName, setDatabaseName] = useState<string>("");
  const createTree = useWorkspaceStore((s) => s.createTree);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && !disableCancel && onCancellation()}
    >
      <DialogContent
        data-tutorial="create-dialog"
        showCloseButton={!disableCancel}
        onEscapeKeyDown={(event) => {
          if (disableCancel) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (disableCancel) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 px-1">
          <div className="space-y-2">
            <FieldLabel htmlFor="databaseName">{t("name")}</FieldLabel>
            <Input
              id="databaseName"
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          {disableCancel ? (
            <Button variant="outline" size="sm" disabled>
              {t("cancel")}
            </Button>
          ) : (
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t("cancel")}
              </Button>
            </DialogClose>
          )}
          <Button
            variant="success"
            size="sm"
            onClick={onConfirmation}
            disabled={!databaseName}
            data-tutorial="tree-create-btn"
          >
            {t("create")}
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
    if (!databaseName) return;
    try {
      await createTree(databaseName);
      resetState();
      onConfirm();
    } catch (e) {
      console.error(e);
      toast.error(t("toast-error"));
    }
  }

  function resetState() {
    setDatabaseName("");
  }
};
