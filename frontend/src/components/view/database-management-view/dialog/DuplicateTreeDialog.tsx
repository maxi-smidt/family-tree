import { useEffect, useState } from "react";
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
import { useTreeStore } from "@/hooks/useTreeStore";
import { Tree } from "@/types/tree";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  tree: Tree | null;
  onClose: () => void;
};

export const DuplicateTreeDialog = ({ tree, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.duplicate-tree",
  });
  const mergeTrees = useTreeStore((s) => s.mergeTrees);

  const [name, setName] = useState("");
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Reset the suggested name whenever a new source tree is picked.
  useEffect(() => {
    if (tree) setName(`${tree.name} ${t("copy-suffix")}`);
  }, [tree, t]);

  const handleClose = () => {
    if (isDuplicating) return;
    onClose();
  };

  const handleDuplicate = async () => {
    if (!tree) return;
    if (!name.trim()) {
      toast.error(t("toast-error-name"));
      return;
    }

    setIsDuplicating(true);
    try {
      // A single-source merge clones the tree into a brand-new, independent copy.
      await mergeTrees(name.trim(), tree.id);
      toast.success(t("toast-success"));
      onClose();
    } catch (e) {
      console.error("Duplicate failed", e);
      toast.error(t("toast-error"));
    } finally {
      setIsDuplicating(false);
    }
  };

  return (
    <Dialog open={!!tree} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: tree?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4 px-1">
          <FieldLabel htmlFor="duplicate-tree-name">{t("name")}</FieldLabel>
          <Input
            id="duplicate-tree-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleDuplicate();
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isDuplicating}
            >
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleDuplicate}
            disabled={isDuplicating || !name.trim()}
          >
            {isDuplicating ? t("duplicating") : t("duplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
