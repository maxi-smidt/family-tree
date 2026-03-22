import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Member } from "@/types/member";
import { useEffect, useState } from "react";
import { ViewMode } from "./ViewMode";
import { EditMode } from "./EditMode";
import { Button } from "@/components/ui/button";
import { Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useMemberStore } from "@/hooks/useMemberStore";
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

type Props = {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  initialEditMode?: boolean;
  isNewMember?: boolean;
  onDiscardNewMember?: () => Promise<void> | void;
};

export const MemberSheet = ({
  isOpen,
  onClose,
  member,
  initialEditMode = false,
  isNewMember = false,
  onDiscardNewMember,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet",
  });
  const { removeMember } = useMemberStore();
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setIsEditMode(initialEditMode);
  }, [initialEditMode, isOpen]);

  if (!member) return null;

  const handleDelete = async () => {
    await removeMember(member.id);
    setIsDeleteDialogOpen(false);
    onClose();
  };

  const handleCloseRequest = () => {
    if (isDirty) {
      setIsUnsavedDialogOpen(true);
      return;
    }
    onClose();
  };

  const handleDiscard = async () => {
    if (isNewMember && onDiscardNewMember) {
      await onDiscardNewMember();
    }
    setIsUnsavedDialogOpen(false);
    onClose();
  };

  const handleSaveAndClose = () => {
    const form = document.getElementById(
      "edit-member-form",
    ) as HTMLFormElement | null;
    form?.requestSubmit();
    setIsUnsavedDialogOpen(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleCloseRequest()}>
      <SheetContent className="w-100 sm:w-135" showCloseButton={false}>
        <SheetHeader className="border-b">
          <div className="pr-10">
            <SheetTitle>
              {isEditMode ? t("edit-title") : t("detail-title")}
            </SheetTitle>
            <SheetDescription>
              {isEditMode ? t("edit-description") : t("detail-description")}
            </SheetDescription>
          </div>
          <div className="absolute top-4 right-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsEditMode((value) => !value)}
            >
              {isEditMode ? <Eye /> : <Pencil />}
            </Button>
          </div>
        </SheetHeader>

        <div className="relative flex-1 overflow-hidden flex flex-col">
          <div className="px-4 pb-4 overflow-y-auto flex-1">
            {isEditMode ? (
              <EditMode
                member={member}
                onSaved={onClose}
                onDirtyChange={setIsDirty}
              />
            ) : (
              <ViewMode member={member} />
            )}
          </div>
        </div>

        {isEditMode && (
          <SheetFooter className="mt-auto p-4 border-t bg-background gap-2">
            <div className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="flex-1"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                {t("delete")}
              </Button>
              <Button
                type="submit"
                form="edit-member-form"
                className="flex-1"
                size="sm"
              >
                {t("save")}
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
      <AlertDialog
        open={isUnsavedDialogOpen}
        onOpenChange={setIsUnsavedDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unsaved.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("unsaved.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel onClick={() => setIsUnsavedDialogOpen(false)}>
              {t("unsaved.stay")}
            </AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={handleSaveAndClose}>
              {t("unsaved.save")}
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDiscard()}
            >
              {t("unsaved.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={() => void handleDelete()}
        title={t("delete-confirm-title")}
        description={t("delete-confirm-description")}
        cancelText={t("delete-confirm-cancel")}
        confirmText={t("delete-confirm-confirm")}
      />
    </Sheet>
  );
};
