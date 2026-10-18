import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { SavedViewDB } from "@/types/savedView";

interface DeleteSavedViewDialogProps {
  view: SavedViewDB | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (viewId: string) => void;
}

/** A saved view is only a configuration + layout overlay owned by its
 *  creator (#986) — unlike a section, nothing else references it, so
 *  deleting one needs no dependents check. */
export const DeleteSavedViewDialog = ({
  view,
  onOpenChange,
  onDeleted,
}: DeleteSavedViewDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.delete-saved-view",
  });
  const deleteSavedView = useSavedViewStore((s) => s.deleteSavedView);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [view]);

  const handleDelete = async () => {
    if (!view) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSavedView(view.id);
      onOpenChange(false);
      onDeleted?.(view.id);
    } catch {
      setError(t("delete-error"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={view !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { name: view?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: Radix's Action closes the
           * controlled dialog unconditionally on click, which would dismiss
           * this dialog before we know whether the delete succeeded. */}
          <Button
            onClick={() => void handleDelete()}
            variant="destructive"
            disabled={deleting}
          >
            {deleting ? t("deleting") : t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
