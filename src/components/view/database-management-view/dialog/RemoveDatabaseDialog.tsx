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
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { useDatabaseManager } from "@/hooks/useDatabaseManager";
import { useTranslation } from "react-i18next";

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
  const databases = useFamilyTreeSettings((s) => s.databases);
  const selectedDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const { removeDatabase } = useDatabaseManager();
  const [typedName, setTypedName] = useState("");

  if (!selectedDatabase) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancellation()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: selectedDatabase.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 px-1">
          <div className="space-y-2">
            <FieldLabel htmlFor="databaseName">{t("name")}</FieldLabel>
            <Input
              id="databaseName"
              placeholder={selectedDatabase.name}
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
            disabled={typedName !== selectedDatabase.name}
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
  function onConfirmation() {
    if (typedName !== selectedDatabase?.name) return;
    const nextDatabase = databases.find((db) => db.id !== selectedDatabase.id);

    if (!nextDatabase) {
      toast.warning(t("toast-warning"));
    }
    setSelectedDatabase(nextDatabase);
    void removeDatabase(selectedDatabase);
    resetState();
    toast.success(t("toast-success"));
    onConfirm();
  }

  function resetState() {
    setTypedName("");
  }
};
