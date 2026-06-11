import { useEffect, useState } from "react";
import { useTreeStore } from "@/hooks/useTreeStore";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Tree } from "@/types/tree";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, the dialog is in edit-sources mode for this view. */
  view?: Tree | null;
};

export const VirtualViewDialog = ({ isOpen, onClose, view }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.virtual-view",
  });
  const trees = useTreeStore((s) => s.trees);
  const createVirtualView = useTreeStore((s) => s.createVirtualView);
  const updateVirtualViewSources = useTreeStore(
    (s) => s.updateVirtualViewSources,
  );

  const isEdit = !!view;
  const [name, setName] = useState(view?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(view?.sources?.map((s) => s.tree_id) ?? []),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(view?.name ?? "");
      setSelectedIds(new Set(view?.sources?.map((s) => s.tree_id) ?? []));
    }
  }, [isOpen, view]);

  const toggleTree = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit =
    !isSubmitting &&
    name.trim().length > 0 &&
    selectedIds.size >= 2;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      if (isEdit && view) {
        await updateVirtualViewSources(view, Array.from(selectedIds));
        toast.success(t("toast-update-success"));
      } else {
        await createVirtualView(name.trim(), Array.from(selectedIds));
        toast.success(t("toast-create-success"));
      }
      onClose();
    } catch {
      toast.error(isEdit ? t("toast-update-error") : t("toast-create-error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("title-edit") : t("title-create")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vv-name">{t("name-label")}</Label>
              <Input
                id="vv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("name-placeholder")}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>{t("sources-label")}</Label>
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto border rounded-md p-2">
              {trees.map((tree) => (
                <label
                  key={tree.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tree.id)}
                    onChange={() => toggleTree(tree.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">{tree.name}</span>
                </label>
              ))}
            </div>
            {selectedIds.size < 2 && (
              <p className="text-xs text-muted-foreground">
                {t("min-sources-hint")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isEdit ? t("confirm-edit") : t("confirm-create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
