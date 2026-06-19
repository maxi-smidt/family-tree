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
import { useTreeStore } from "@/hooks/useTreeStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const CreateDatabaseDialog = ({
  isOpen,
  onConfirm,
  onCancel,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.create-database",
  });
  const [databaseId, setDatabaseId] = useState(crypto.randomUUID());
  const [databaseName, setDatabaseName] = useState<string>("");
  const createTree = useTreeStore((s) => s.createTree);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancellation()}>
      <DialogContent data-tutorial="create-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 px-1">
          <div className="space-y-2">
            <FieldLabel htmlFor="databaseId">{t("id")}</FieldLabel>
            <Input id="databaseId" value={databaseId} disabled />
          </div>

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
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancellation}>
              {t("cancel")}
            </Button>
          </DialogClose>
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
      await createTree(databaseName, databaseId);
      resetState();
      onConfirm();
    } catch (e) {
      console.error(e);
      toast.error(t("toast-error"));
    }
  }

  function resetState() {
    setDatabaseName("");
    setDatabaseId(crypto.randomUUID());
  }
};
