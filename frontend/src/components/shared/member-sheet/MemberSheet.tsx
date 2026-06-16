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
import { useEventStore } from "@/hooks/useEventStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { UnsavedChangesDialog } from "@/components/shared/dialog/UnsavedChangesDialog";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  initialEditMode?: boolean;
  canEdit?: boolean;
  isNewMember?: boolean;
  onDiscardNewMember?: () => Promise<void> | void;
  onSaveNewMember?: (data: Member) => Promise<void> | void;
};

export const MemberSheet = ({
  isOpen,
  onClose,
  member,
  initialEditMode = false,
  canEdit = true,
  isNewMember = false,
  onDiscardNewMember,
  onSaveNewMember,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet",
  });
  const { removeMember, fetchMemberDetail } = useMemberStore();
  const { refreshEvents, initialized: eventsInitialized } = useEventStore();
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const effectiveCanEdit = canEdit || isNewMember;
  const isViewingEditMode = effectiveCanEdit && isEditMode;

  useEffect(() => {
    setIsEditMode(effectiveCanEdit ? initialEditMode : false);
  }, [effectiveCanEdit, initialEditMode, isOpen]);

  // Fetch full member detail when the sheet opens for an existing member
  useEffect(() => {
    if (isOpen && member && !isNewMember) {
      setIsLoadingDetail(true);
      void fetchMemberDetail(member.id).finally(() => setIsLoadingDetail(false));
    }
  }, [isOpen, member?.id, isNewMember]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load events if not yet loaded (needed for syncVitalEvent in updateMemberPartial)
  useEffect(() => {
    if (isOpen && !isNewMember && !eventsInitialized && selectedTree) {
      void refreshEvents(selectedTree.id);
    }
  }, [isOpen, isNewMember, eventsInitialized, selectedTree, refreshEvents]);

  if (!member) return null;

  const handleDelete = async () => {
    await removeMember(member.id);
    setIsDeleteDialogOpen(false);
    onClose();
  };

  const handleCloseRequest = () => {
    if (isDirty && isViewingEditMode) {
      setIsUnsavedDialogOpen(true);
      return;
    }
    if (isNewMember && onDiscardNewMember) {
      void onDiscardNewMember();
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
      <SheetContent
        className="w-full max-w-full sm:w-135 sm:max-w-none"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          if (isViewingEditMode) {
            e.preventDefault();
            requestAnimationFrame(() => {
              document.getElementById("firstName")?.focus();
            });
          }
        }}
      >
        <SheetHeader className="border-b">
          <div className="pr-10">
            <SheetTitle>
              {isViewingEditMode ? t("edit-title") : t("detail-title")}
            </SheetTitle>
            <SheetDescription>
              {isViewingEditMode
                ? t("edit-description")
                : t("detail-description")}
            </SheetDescription>
          </div>
          {effectiveCanEdit && (
            <div className="absolute top-4 right-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditMode((value) => !value)}
              >
                {isViewingEditMode ? <Eye /> : <Pencil />}
              </Button>
            </div>
          )}
        </SheetHeader>

        <div className="relative flex-1 overflow-hidden flex flex-col">
          <div className="px-4 pb-4 overflow-y-auto flex-1">
            {isLoadingDetail && !isNewMember ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                <Spinner className="size-5" />
                <span className="text-sm">{t("loading-detail")}</span>
              </div>
            ) : isViewingEditMode ? (
              <EditMode
                member={member}
                isNew={isNewMember}
                onSaved={async (data) => {
                  if (isNewMember && onSaveNewMember) {
                    await onSaveNewMember(data);
                  }
                  onClose();
                }}
                onDirtyChange={setIsDirty}
              />
            ) : (
              <ViewMode member={member} />
            )}
          </div>
        </div>

        {isViewingEditMode && (
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
      <UnsavedChangesDialog
        open={isUnsavedDialogOpen}
        onOpenChange={setIsUnsavedDialogOpen}
        onStay={() => setIsUnsavedDialogOpen(false)}
        onSave={handleSaveAndClose}
        onDiscard={() => void handleDiscard()}
      />
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
