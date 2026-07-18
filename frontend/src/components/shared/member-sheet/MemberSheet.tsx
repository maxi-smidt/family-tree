import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Member } from "@/types/member";
import { useEffect, useRef, useState } from "react";
import { ViewMode } from "./ViewMode";
import { EditMode, SaveStatus } from "./EditMode";
import { Button } from "@/components/ui/button";
import { Check, CircleAlert, Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useFeature } from "@/hooks/useAuthStore";
import { useMemberEditors } from "@/hooks/usePresenceStore";
import { UnsavedChangesDialog } from "@/components/shared/dialog/UnsavedChangesDialog";
import { Spinner } from "@/components/ui/spinner";
import { MemberSheetTab } from "@/utils/memberSheetState";

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
  const { removeMember, fetchMemberDetail, detailLoadedIds } = useMemberStore();
  const { refreshEvents, initialized: eventsInitialized } = useEventStore();
  const { refreshStories, initialized: storiesInitialized } = useStoryStore();
  const { refreshTasks, initialized: tasksInitialized } = useTaskStore();
  const restrictions = useTreeStore((s) => s.selectedTree?.restrictions);
  const tasksEnabled =
    useFeature("research_tasks") && !restrictions?.includes("tasks");
  const { refreshDocuments, initialized: documentsInitialized } =
    useDocumentStore();
  const { refreshGalleryImages, initialized: galleryInitialized } =
    useGalleryStore();
  const setMapFocus = useNavigationStore((s) => s.setMapFocus);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const treeId = useTreeStore((s) => s.selectedTree?.id);
  const savedSheetState = useMemberSheetStore((s) =>
    treeId ? s.openSheets[treeId] : undefined,
  );
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const clearOpenSheet = useMemberSheetStore((s) => s.clearOpenSheet);
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const flushAutosaveRef = useRef<() => Promise<void>>(async () => {});
  const effectiveCanEdit = canEdit || isNewMember;
  const isViewingEditMode = effectiveCanEdit && isEditMode;
  const activeTab: MemberSheetTab =
    savedSheetState && savedSheetState.memberId === member?.id
      ? savedSheetState.tab
      : "identity";
  const editors = useMemberEditors(member?.id);

  useEffect(() => {
    setIsEditMode(effectiveCanEdit ? initialEditMode : false);
  }, [effectiveCanEdit, initialEditMode, isOpen]);

  useEffect(() => {
    if (!isOpen || !member || isNewMember || !treeId) return;
    setOpenSheet(treeId, {
      memberId: member.id,
      tab: savedSheetState?.memberId === member.id ? activeTab : "identity",
      mode: isViewingEditMode ? "edit" : "view",
    });
  }, [
    activeTab,
    isNewMember,
    isOpen,
    isViewingEditMode,
    member?.id,
    savedSheetState?.memberId,
    setOpenSheet,
    treeId,
  ]);

  // Fetch full member detail when the sheet opens for an existing member.
  // Skip the spinner entirely when detail is already cached for this member.
  useEffect(() => {
    if (isOpen && member && !isNewMember) {
      const alreadyLoaded = detailLoadedIds.has(member.id);
      if (!alreadyLoaded) {
        setIsLoadingDetail(true);
      }
      void fetchMemberDetail(member.id).finally(() =>
        setIsLoadingDetail(false),
      );
    }
  }, [isOpen, member?.id, isNewMember]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defer secondary-domain stores until the sheet opens for an existing member.
  // Passing `|| !isOpen || isNewMember` makes the shared hook a no-op while the
  // sheet is closed or showing an unsaved new member.
  useDeferredStoreLoad(
    eventsInitialized || !isOpen || isNewMember,
    refreshEvents,
  );
  useDeferredStoreLoad(
    storiesInitialized || !isOpen || isNewMember,
    refreshStories,
  );
  useDeferredStoreLoad(
    tasksInitialized || !tasksEnabled || !isOpen || isNewMember,
    refreshTasks,
  );
  useDeferredStoreLoad(
    documentsInitialized || !isOpen || isNewMember,
    refreshDocuments,
  );
  useDeferredStoreLoad(
    galleryInitialized || !isOpen || isNewMember,
    refreshGalleryImages,
  );

  if (!member) return null;

  const handleTabChange = (tab: MemberSheetTab) => {
    if (!treeId || isNewMember) return;
    setOpenSheet(treeId, {
      memberId: member.id,
      tab,
      mode: isViewingEditMode ? "edit" : "view",
    });
  };

  const closeSheet = async () => {
    if (!isNewMember) await flushAutosaveRef.current();
    if (treeId) clearOpenSheet(treeId);
    onClose();
  };

  const handleDelete = async () => {
    await flushAutosaveRef.current();
    await removeMember(member.id);
    setIsDeleteDialogOpen(false);
    await closeSheet();
  };

  const handleCloseRequest = async () => {
    // Existing members autosave (and flush on EditMode unmount), so there's
    // never an unsaved change to warn about there — only new members, which
    // are purely client-side until an explicit "Create member", need the
    // discard/save/stay prompt.
    if (isNewMember && isDirty && isViewingEditMode) {
      setIsUnsavedDialogOpen(true);
      return;
    }
    if (isNewMember && onDiscardNewMember) {
      await onDiscardNewMember();
    }
    await closeSheet();
  };

  const handleDiscard = async () => {
    if (isNewMember && onDiscardNewMember) {
      await onDiscardNewMember();
    }
    setIsUnsavedDialogOpen(false);
    await closeSheet();
  };

  const handleSaveAndClose = () => {
    const form = document.getElementById(
      "edit-member-form",
    ) as HTMLFormElement | null;
    form?.requestSubmit();
    setIsUnsavedDialogOpen(false);
  };

  // Cross-view "show on map" (#554): jump from a location field in the view
  // mode straight to the Map view, focused on that location.
  const handleShowLocationOnMap = async (
    location: string,
    memberId: string,
  ) => {
    await closeSheet();
    setMapFocus({ location, memberId });
    navigateTo("map-view");
  };

  const handleModeToggle = async () => {
    if (isViewingEditMode && !isNewMember) {
      await flushAutosaveRef.current();
    }
    setIsEditMode((value) => !value);
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) void handleCloseRequest();
      }}
    >
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
            {editors.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500">
                <Pencil className="size-3 shrink-0" />
                <span className="truncate">
                  {t("presence-editing", {
                    name: editors.map((e) => e.displayName).join(", "),
                  })}
                </span>
              </div>
            )}
          </div>
          {effectiveCanEdit && (
            <div className="absolute top-4 right-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleModeToggle()}
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
                key={`${treeId ?? "no-tree"}:${member.id}`}
                member={member}
                isNew={isNewMember}
                onSaved={async (data) => {
                  if (isNewMember && onSaveNewMember) {
                    await onSaveNewMember(data);
                  }
                  await closeSheet();
                }}
                onDirtyChange={setIsDirty}
                onSaveStatusChange={setSaveStatus}
                onAutosaveFlush={(flush) => {
                  flushAutosaveRef.current = flush;
                }}
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            ) : (
              <ViewMode
                member={member}
                onShowLocationOnMap={(location, memberId) => {
                  void handleShowLocationOnMap(location, memberId);
                }}
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            )}
          </div>
        </div>

        {isViewingEditMode && (
          <SheetFooter className="mt-auto p-4 border-t bg-background gap-2">
            {isNewMember ? (
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
                  {t("create")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  {t("delete")}
                </Button>
                {saveStatus === "saving" && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    {t("saving")}
                  </span>
                )}
                {saveStatus === "saved" && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="size-3.5" />
                    {t("saved")}
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive">
                    <CircleAlert className="size-3.5" />
                    {t("save-error")}
                  </span>
                )}
              </div>
            )}
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
