import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Field, FieldLabel, FieldSet } from "@/components/ui/field.tsx";
import { useState } from "react";

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
  const [databaseId, setDatabaseId] = useState(crypto.randomUUID());

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create database</DialogTitle>
          <DialogDescription>
            Here you can create a new database to start a new family tree from
            scratch.
          </DialogDescription>
        </DialogHeader>
        <FieldSet>
          <Field>
            <FieldLabel htmlFor="databaseId">ID</FieldLabel>
            <Input id="databaseId" value={} />
          </Field>
        </FieldSet>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="success" size="sm" onClick={onConfirm}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
