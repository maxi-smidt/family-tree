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
import { useTreeStore } from "@/hooks/useTreeStore";
import { PARENT_RELATION_TYPE, RelationType } from "@/types/member";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.add-relation" });
  const { t: tRelation } = useTranslation(undefined, {
    keyPrefix: "common.relation-types",
  });
  const { relationTypes } = useTreeStore();
  const [selectedType, setSelectedType] = useState<RelationType>("partner");

  const handleConfirm = () => {
    onConfirm(selectedType);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="py-4 px-1">
          <Select
            value={selectedType}
            onValueChange={(value) => setSelectedType(value as RelationType)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {relationTypes
                .filter((t) => t.id !== PARENT_RELATION_TYPE)
                .map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {tRelation(type.id, {
                      defaultValue: type.description ?? type.id,
                    })}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            {t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
