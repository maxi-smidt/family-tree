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
          <DialogTitle>Remove database</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove the selected database? This action
            cannot be undone. To be sure, type the database name "
            {selectedDatabase.name}" below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[50px_1fr] gap-y-2 items-center">
          <FieldLabel htmlFor="databaseName">Name</FieldLabel>
          <Input
            id="databaseName"
            placeholder={selectedDatabase.name}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancellation}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirmation}
            disabled={typedName !== selectedDatabase.name}
          >
            Remove
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
      toast.warning("You removed the last database. Create a new one.");
    }
    setSelectedDatabase(nextDatabase);
    void removeDatabase(selectedDatabase);
    resetState();
    toast.success("Database removed successfully");
    onConfirm();
  }

  function resetState() {
    setTypedName("");
  }
};
