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
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
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
  const addDatabase = useFamilyTreeSettings((s) => s.addDatabase);
  const selectDatabase = useFamilyTreeSettings((s) => s.setSelectedDatabase);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancellation()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[50px_1fr] gap-y-2 items-center">
          <FieldLabel htmlFor="databaseId">{t("id")}</FieldLabel>
          <Input id="databaseId" value={databaseId} disabled />

          <FieldLabel htmlFor="databaseName">{t("name")}</FieldLabel>
          <Input
            id="databaseName"
            value={databaseName}
            onChange={(e) => setDatabaseName(e.target.value)}
          />
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

  function onConfirmation() {
    if (!databaseName) return;
    const newDatabase = {
      id: databaseId,
      name: databaseName,
    };
    addDatabase(newDatabase);
    selectDatabase(newDatabase);
    resetState();
    onConfirm();
  }

  function resetState() {
    setDatabaseName("");
    setDatabaseId(crypto.randomUUID());
  }
};
