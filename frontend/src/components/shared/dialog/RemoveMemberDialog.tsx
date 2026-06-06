import { Member } from "@/types/member";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type Props = {
  members: Member[];
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const RemoveMemberDialog = ({
  members,
  isOpen,
  onConfirm,
  onCancel,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.remove-node",
  });

  if (members.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { count: members.length })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          {t("validation")}
          <ul className="list-disc ml-6 my-2">
            {members.map((m) => (
              <li key={m.id}>{`${m.firstName} ${m.lastName}`}</li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
