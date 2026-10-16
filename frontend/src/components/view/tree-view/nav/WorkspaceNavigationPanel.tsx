import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderTree,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { WorkspaceSearchBox } from "@/components/view/tree-view/nav/WorkspaceSearchBox";
import { CreateSectionDialog } from "@/components/view/tree-view/nav/CreateSectionDialog";
import { RenameSectionDialog } from "@/components/view/tree-view/nav/RenameSectionDialog";
import { DeleteSectionDialog } from "@/components/view/tree-view/nav/DeleteSectionDialog";
import { SectionMembersDialog } from "@/components/view/tree-view/nav/SectionMembersDialog";
import { SavedViewFormDialog } from "@/components/view/tree-view/nav/SavedViewFormDialog";
import { DeleteSavedViewDialog } from "@/components/view/tree-view/nav/DeleteSavedViewDialog";
import { SectionDB } from "@/types/section";
import { SavedViewDB } from "@/types/savedView";
import { WorkspaceSearchHitDB } from "@/types/member";

interface WorkspaceNavigationPanelProps {
  workspaceId: string;
  canWrite: boolean;
  /** Rendered on a narrow canvas: the trigger shows only its icon. */
  compact?: boolean;
}

/**
 * Workspace navigation tree (#988): Explore / Sections / Saved views, plus
 * workspace-wide search. Selecting a section opens it as a focused,
 * section-scoped neighborhood on the canvas (#989); "Explore" returns to the
 * unscoped workspace view. Selecting a saved view re-centers on its focus
 * person. Creating/editing/duplicating/deleting saved views (#1013) mirrors
 * the section actions below.
 *
 * Rendered as a "Whole family ▾" menu floating on the canvas rather than a
 * second sidebar next to the app navigation.
 */
export const WorkspaceNavigationPanel = ({
  workspaceId,
  canWrite,
  compact = false,
}: WorkspaceNavigationPanelProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "workspace-nav" });
  const [menuOpen, setMenuOpen] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SectionDB | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SectionDB | null>(null);
  const [membersTarget, setMembersTarget] = useState<SectionDB | null>(null);
  // null = closed; { view: null } = create; { view } = edit.
  const [savedViewForm, setSavedViewForm] = useState<{
    view: SavedViewDB | null;
  } | null>(null);
  const [deleteViewTarget, setDeleteViewTarget] = useState<SavedViewDB | null>(
    null,
  );

  const sections = useSectionStore((s) => s.sections);
  const sectionsInitialized = useSectionStore((s) => s.initialized);
  const refreshSections = useSectionStore((s) => s.refreshSections);
  useDeferredStoreLoad(sectionsInitialized, refreshSections);

  const views = useSavedViewStore((s) => s.views);
  const viewsInitialized = useSavedViewStore((s) => s.initialized);
  const refreshSavedViews = useSavedViewStore((s) => s.refreshSavedViews);
  const duplicateSavedView = useSavedViewStore((s) => s.duplicateSavedView);
  const openSavedView = useSavedViewStore((s) => s.openSavedView);
  const canCreateSections = useWorkspaceStore(
    (s) =>
      s.selectedTree?.can_create_sections ?? s.selectedTree?.role === "owner",
  );
  useDeferredStoreLoad(viewsInitialized, refreshSavedViews);

  const mode = useWorkspaceNavStore((s) => s.mode);
  const selectedSectionId = useWorkspaceNavStore((s) => s.selectedSectionId);
  const selectedSavedViewId = useWorkspaceNavStore(
    (s) => s.selectedSavedViewId,
  );
  const selectExplore = useWorkspaceNavStore((s) => s.selectExplore);
  const selectSection = useWorkspaceNavStore((s) => s.selectSection);
  const selectSavedView = useWorkspaceNavStore((s) => s.selectSavedView);

  const setFocusRoot = useMemberStore((s) => s.setFocusRoot);
  const applySavedView = useMemberStore((s) => s.applySavedView);
  const focusSection = useMemberStore((s) => s.focusSection);
  const exitFocus = useMemberStore((s) => s.exitFocus);
  const focusRootId = useMemberStore((s) => s.focusRootId);
  const focusSectionIds = useMemberStore((s) => s.focusSectionIds);
  const focusMember = (memberId: string) => void setFocusRoot(memberId);

  const handleSelectExplore = () => {
    setMenuOpen(false);
    selectExplore();
    void exitFocus();
  };

  const handleSelectSection = (sectionId: string) => {
    setMenuOpen(false);
    selectSection(sectionId);
    void focusSection(sectionId);
  };

  const handleSelectSearchHit = (hit: WorkspaceSearchHitDB) => {
    setMenuOpen(false);
    selectExplore();
    focusMember(hit.id);
  };

  const handleSelectSavedView = (viewId: string) => {
    setMenuOpen(false);
    selectSavedView(viewId);
    void openSavedView(viewId).catch(() =>
      toast.error(t("saved-view-form.edit-error")),
    );
  };

  const handleSavedViewSaved = (saved: SavedViewDB, wasCreate: boolean) => {
    // A brand-new view is opened immediately; an edit to the view already
    // open re-centers the canvas on whatever it now points to. Focuses from
    // `saved` directly rather than looking it up in `views` — the store's
    // update hasn't necessarily been reflected in this render's closure yet.
    if (
      wasCreate ||
      (mode === "saved-view" && selectedSavedViewId === saved.id)
    ) {
      selectSavedView(saved.id);
      void applySavedView(saved);
    }
  };

  const handleSavedViewDeleted = (viewId: string) => {
    if (mode === "saved-view" && selectedSavedViewId === viewId) {
      handleSelectExplore();
    }
  };

  const handleDuplicateSavedView = async (view: SavedViewDB) => {
    try {
      await duplicateSavedView(view, t("duplicate-name", { name: view.name }));
    } catch {
      toast.error(t("duplicate-error"));
    }
  };

  const listContent = (
    <>
      <div className="border-b p-2">
        <WorkspaceSearchBox
          workspaceId={workspaceId}
          onSelectHit={handleSelectSearchHit}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={handleSelectExplore}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
            mode === "explore" &&
              "bg-accent font-medium text-accent-foreground",
          )}
        >
          <Layers className="h-4 w-4" />
          {t("whole-family")}
        </button>

        <div className="mt-2">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
              onClick={() => setSectionsOpen((o) => !o)}
            >
              {sectionsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {t("sections")}
            </button>
            {canWrite && canCreateSections && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCreateOpen(true)}
                aria-label={t("create-section.title")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {sectionsOpen && (
            <ul>
              {sections.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground">
                  {t("no-sections")}
                </li>
              )}
              {sections.map((section) => (
                <li key={section.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => handleSelectSection(section.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      mode === "section" &&
                        selectedSectionId === section.id &&
                        "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    <FolderTree className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {section.name}
                    </span>
                    <Badge variant="secondary">{section.member_count}</Badge>
                  </button>
                  {canWrite && section.can_write && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={t("section-actions", {
                            name: section.name,
                          })}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setMembersTarget(section)}
                        >
                          {t("edit-members")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setRenameTarget(section)}
                        >
                          {t("rename")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteTarget(section)}
                          variant="destructive"
                        >
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
              onClick={() => setViewsOpen((o) => !o)}
            >
              {viewsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {t("saved-views")}
            </button>
            {canWrite && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSavedViewForm({ view: null })}
                aria-label={t("saved-view-form.title-create")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {viewsOpen && (
            <ul>
              {views.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground">
                  {t("no-saved-views")}
                </li>
              )}
              {views.map((view) => (
                <li key={view.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => handleSelectSavedView(view.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      mode === "saved-view" &&
                        selectedSavedViewId === view.id &&
                        "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    <Bookmark className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  </button>
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={t("saved-view-actions", {
                            name: view.name,
                          })}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setSavedViewForm({ view })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void handleDuplicateSavedView(view)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t("duplicate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteViewTarget(view)}
                          variant="destructive"
                        >
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  const dialogs = (
    <>
      <CreateSectionDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RenameSectionDialog
        section={renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      />
      <DeleteSectionDialog
        section={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />
      <SectionMembersDialog
        section={membersTarget}
        workspaceId={workspaceId}
        onOpenChange={(open) => !open && setMembersTarget(null)}
      />
      <SavedViewFormDialog
        open={savedViewForm !== null}
        view={savedViewForm?.view ?? null}
        initialFocusMemberId={focusRootId}
        initialSectionIds={focusSectionIds ?? []}
        onOpenChange={(open) => !open && setSavedViewForm(null)}
        onSaved={handleSavedViewSaved}
      />
      <DeleteSavedViewDialog
        view={deleteViewTarget}
        onOpenChange={(open) => !open && setDeleteViewTarget(null)}
        onDeleted={handleSavedViewDeleted}
      />
    </>
  );

  const currentLabel =
    mode === "section"
      ? (sections.find((x) => x.id === selectedSectionId)?.name ??
        t("whole-family"))
      : mode === "saved-view"
        ? (views.find((v) => v.id === selectedSavedViewId)?.name ??
          t("whole-family"))
        : t("whole-family");
  const CurrentIcon =
    mode === "section" ? FolderTree : mode === "saved-view" ? Bookmark : Layers;

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button size="default"
            variant="outline"
            className="max-w-[16rem] gap-2 bg-card shadow-xs"
            aria-label={t("open-menu", { name: currentLabel })}
            title={currentLabel}
          >
            <CurrentIcon className="text-muted-foreground" />
            {!compact && <span className="truncate">{currentLabel}</span>}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[min(70vh,34rem)] w-80 flex-col gap-0 overflow-hidden p-0"
          aria-label={t("aria-label")}
        >
          {listContent}
        </PopoverContent>
      </Popover>
      {dialogs}
    </>
  );
};
