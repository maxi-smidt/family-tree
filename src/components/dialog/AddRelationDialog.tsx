import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { RelationType } from "@/types/member";

interface AddRelationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (type: RelationType) => void;
}

export const AddRelationDialog = ({
  isOpen,
  onClose,
  onConfirm,
}: AddRelationDialogProps) => {
  const { relationTypes } = useFamilyStore();
  const [selectedType, setSelectedType] = useState<RelationType>("partner");

  const handleConfirm = () => {
    onConfirm(selectedType);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Relationship</DialogTitle>
          <DialogDescription>
            Select the type of relationship you want to create.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Select
            value={selectedType}
            onValueChange={(value) => setSelectedType(value as RelationType)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select relationship type" />
            </SelectTrigger>
            <SelectContent>
              {relationTypes
                .filter((t) => t.id !== "parent")
                .map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.description}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Add Relation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
