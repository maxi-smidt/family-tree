import { useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
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
import { Workspace } from "@/types/workspace";
import { ApiError } from "@/services/api";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, the dialog is in edit-sources mode for this view. */
  view?: Workspace | null;
};

export const VirtualViewDialog = ({ isOpen, onClose, view }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.virtual-view",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const virtualViews = useWorkspaceStore((s) => s.virtualViews);
  const createVirtualView = useWorkspaceStore((s) => s.createVirtualView);
  const updateVirtualViewSources = useWorkspaceStore(
    (s) => s.updateVirtualViewSources,
  );

  const isEdit = !!view;

  // Other virtual views that may be used as sources. A candidate is excluded
  // when picking it would form a cycle — i.e. the view being edited is reachable
  // through the candidate's own (virtual) sources. The backend enforces this
  // too; this just keeps impossible options out of the list.
  const selectableViews = useMemo(() => {
    if (!view) return virtualViews;
    const byId = new Map(virtualViews.map((v) => [v.id, v]));
    const reachesEdited = (startId: string): boolean => {
      const stack = [startId];
      const seen = new Set<string>();
      while (stack.length) {
        const id = stack.pop();
        if (id === undefined) continue;
        if (id === view.id) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        byId.get(id)?.sources?.forEach((s) => {
          if (s.is_virtual) stack.push(s.workspace_id);
        });
      }
      return false;
    };
    return virtualViews.filter((v) => v.id !== view.id && !reachesEdited(v.id));
  }, [view, virtualViews]);
  const [name, setName] = useState(view?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(view?.sources?.map((s) => s.workspace_id) ?? []),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(view?.name ?? "");
      setSelectedIds(new Set(view?.sources?.map((s) => s.workspace_id) ?? []));
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
    (isEdit || name.trim().length > 0) &&
    selectedIds.size >= 2;

  const errorCode = (err: unknown) =>
    err instanceof ApiError ? err.message : undefined;

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
    } catch (err) {
      const code = errorCode(err);
      if (code === "virtual_view_sources_no_overlap") {
        toast.error(t("error-no-overlap"));
      } else if (code === "virtual_view_source_cycle") {
        toast.error(t("error-cycle"));
      } else {
        toast.error(isEdit ? t("toast-update-error") : t("toast-create-error"));
      }
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
              {workspaces.map((tree) => (
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

              {selectableViews.length > 0 && (
                <>
                  <div className="mt-1 pt-1 border-t text-xs font-medium text-muted-foreground">
                    {t("views-label")}
                  </div>
                  {selectableViews.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(v.id)}
                        onChange={() => toggleTree(v.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm">{v.name}</span>
                    </label>
                  ))}
                </>
              )}
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
