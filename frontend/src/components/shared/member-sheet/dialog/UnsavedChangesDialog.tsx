import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStay: () => void;
  onSave: () => void;
  onDiscard: () => void;
};

export const UnsavedChangesDialog = ({
  open,
  onOpenChange,
  onStay,
  onSave,
  onDiscard,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.unsaved",
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-wrap gap-2 sm:gap-2 justify-end">
          <AlertDialogCancel onClick={onStay}>{t("stay")}</AlertDialogCancel>
          <AlertDialogAction
            variant="secondary"
            className="order-last sm:order-none"
            onClick={onSave}
          >
            {t("save")}
          </AlertDialogAction>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            {t("discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
