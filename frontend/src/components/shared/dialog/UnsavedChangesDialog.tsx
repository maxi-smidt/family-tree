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
import { ShortcutHint } from "@/components/ui/shortcut-hint";
import { shortcutAria } from "@/lib/keyboardShortcuts";

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
    keyPrefix: "unsaved-changes",
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
            data-shortcut="save"
            aria-keyshortcuts={shortcutAria("save")}
          >
            {t("save")}
            <ShortcutHint shortcut="save" />
          </AlertDialogAction>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            {t("discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
