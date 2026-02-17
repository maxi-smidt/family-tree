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
import { useTranslation } from "react-i18next";

type ImportChoice = "overwrite" | "keep" | "cancel";

type Props = {
  isOpen: boolean;
  onChoice: (choice: ImportChoice) => void;
};

export const ImportDatabaseDialog = ({ isOpen, onChoice }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.import-database",
  });
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onChoice("cancel")}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChoice("cancel")}
            >
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onChoice("overwrite")}
          >
            {t("overwrite")}
          </Button>
          <Button variant="default" size="sm" onClick={() => onChoice("keep")}>
            {t("keep")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
