import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Compass,
  FolderTree,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { WorkspaceSearchBox } from "@/components/view/tree-view/nav/WorkspaceSearchBox";
import { CreateSectionDialog } from "@/components/view/tree-view/nav/CreateSectionDialog";
import { RenameSectionDialog } from "@/components/view/tree-view/nav/RenameSectionDialog";
import { DeleteSectionDialog } from "@/components/view/tree-view/nav/DeleteSectionDialog";
import { SectionDB } from "@/types/section";
import { WorkspaceSearchHitDB } from "@/types/member";

const COLLAPSE_STORAGE_KEY = "ft_workspace_nav_collapsed";

interface WorkspaceNavigationPanelProps {
  workspaceId: string;
  workspaceName: string;
  canWrite: boolean;
}

/**
 * Workspace navigation tree (#988): Explore / Sections / Saved views, plus
 * workspace-wide search. Selecting a section or saved view here only updates
 * selection state (`useWorkspaceNavStore`) and, where a focus person is
 * known, re-centers the canvas on them — filtering the graph itself by
 * section is #989/#1013's job, not this issue's. Full saved-view
 * creation/configuration/editing also stays in #1013; this panel only lists
 * and opens them.
 */
export const WorkspaceNavigationPanel = ({
  workspaceId,
  workspaceName,
  canWrite,
}: WorkspaceNavigationPanelProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "workspace-nav" });
  const isMobile = useIsMobile();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1",
  );
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };
  // On a narrow viewport there's no room to reserve for an inline panel at
  // all (#988 follow-up) — it opens as a full overlay instead, closed by
  // default, rather than eating most of the canvas the moment it mounts.
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SectionDB | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SectionDB | null>(null);

  const sections = useSectionStore((s) => s.sections);
  const sectionsInitialized = useSectionStore((s) => s.initialized);
  const refreshSections = useSectionStore((s) => s.refreshSections);
  useDeferredStoreLoad(sectionsInitialized, refreshSections);

  const views = useSavedViewStore((s) => s.views);
  const viewsInitialized = useSavedViewStore((s) => s.initialized);
  const refreshSavedViews = useSavedViewStore((s) => s.refreshSavedViews);
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
  const focusMember = (memberId: string) => void setFocusRoot(memberId);

  const handleSelectSearchHit = (hit: WorkspaceSearchHitDB) =>
    focusMember(hit.id);

  const handleSelectSavedView = (viewId: string) => {
    selectSavedView(viewId);
    const view = views.find((v) => v.id === viewId);
    if (view?.focus_member_id) focusMember(view.focus_member_id);
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
          onClick={selectExplore}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
            mode === "explore" &&
              "bg-accent font-medium text-accent-foreground",
          )}
        >
          <Compass className="h-4 w-4" />
          {t("explore")}
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
            {canWrite && (
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
                    onClick={() => selectSection(section.id)}
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
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
            onClick={() => setViewsOpen((o) => !o)}
          >
            {viewsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {t("saved-views")}
          </button>
          {viewsOpen && (
            <ul>
              {views.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground">
                  {t("no-saved-views")}
                </li>
              )}
              {views.map((view) => (
                <li key={view.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectSavedView(view.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      mode === "saved-view" &&
                        selectedSavedViewId === view.id &&
                        "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    <Bookmark className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  </button>
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
    </>
  );

  if (isMobile) {
    return (
      <>
        <div className="flex h-full w-10 flex-none flex-col items-center border-r bg-background py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label={t("expand")}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-72 gap-0 p-0"
            aria-label={t("aria-label")}
          >
            <SheetTitle className="truncate border-b px-3 py-2 text-sm font-semibold">
              {workspaceName}
            </SheetTitle>
            {listContent}
          </SheetContent>
        </Sheet>
        {dialogs}
      </>
    );
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-none flex-col items-center border-r bg-background py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleCollapsed}
          aria-label={t("expand")}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-72 flex-none flex-col border-r bg-background"
      aria-label={t("aria-label")}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-semibold" title={workspaceName}>
          {workspaceName}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleCollapsed}
          aria-label={t("collapse")}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      {listContent}
      {dialogs}
    </div>
  );
};
