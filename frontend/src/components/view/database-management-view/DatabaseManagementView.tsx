import { useState } from "react";
import { useJobStore } from "@/hooks/useJobStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { pickFile, useWorkspaceManager } from "@/hooks/useWorkspaceManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { WorkspaceMonogram } from "@/components/shared/WorkspaceMonogram";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/dateUtils";
import {
  Plus,
  Trash2,
  Edit2,
  HardDriveDownload,
  HardDriveUpload,
  Share2,
  Check,
  X,
  Users,
  Copy,
  GitMerge,
  FileUp,
  FileDown,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { CreateDatabaseDialog } from "@/components/shared/dialog/CreateDatabaseDialog";
import { RemoveDatabaseDialog } from "@/components/view/database-management-view/dialog/RemoveDatabaseDialog";
import { ShareTreeDialog } from "@/components/view/database-management-view/dialog/ShareTreeDialog";
import { MergeTreesDialog } from "@/components/view/database-management-view/dialog/MergeTreesDialog";
import { DuplicateTreeDialog } from "@/components/view/database-management-view/dialog/DuplicateTreeDialog";
import { PasswordDialog } from "@/components/shared/dialog/PasswordDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Workspace } from "@/types/workspace";
import { ViewLayout } from "@/components/layout/ViewLayout";

export const DatabaseManagementView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "database-management-view",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const selectTree = useWorkspaceStore((s) => s.selectTree);
  const renameTree = useWorkspaceStore((s) => s.renameTree);
  const loadTrees = useWorkspaceStore((s) => s.loadTrees);
  const {
    exportDatabase,
    importDatabase,
    inspectImport,
    exportGedcom,
    importGedcom,
  } = useWorkspaceManager();
  const [isImporting, setIsImporting] = useState(false);
  const importPct = useJobStore((s) => s.activeJobPct);

  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [isRemoveDatabaseDialogOpen, setIsRemoveDatabaseDialogOpen] =
    useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [duplicateTree, setDuplicateTree] = useState<Workspace | null>(null);
  const [shareTree, setShareTree] = useState<Workspace | null>(null);
  const [passwordDialogState, setPasswordDialogState] = useState<{
    isOpen: boolean;
    mode: "export" | "import";
    resolve: (password: string | null | undefined) => void;
  } | null>(null);
  const [editingDatabaseId, setEditingDatabaseId] = useState<string | null>(
    null,
  );
  const [editingName, setEditingName] = useState("");

  const askPassword = (mode: "export" | "import") => {
    return new Promise<string | null | undefined>((resolve) => {
      setPasswordDialogState({ isOpen: true, mode, resolve });
    });
  };

  const handleImportDatabase = async () => {
    const file = await pickFile(".treedb");
    if (!file) return;

    try {
      const info = await inspectImport(file);
      let password: string | undefined;
      if (info.password_required) {
        const pw = await askPassword("import");
        if (pw === undefined) return;
        if (!pw) {
          toast.error(t("toast-import-error"));
          return;
        }
        password = pw;
      }

      setIsImporting(true);
      await importDatabase(file, password);
      if (info.app_version && info.exported_at) {
        const date = new Date(info.exported_at).toLocaleDateString();
        toast.success(t("toast-import-success"), {
          description: t("import-provenance", {
            version: info.app_version,
            date,
          }),
        });
      } else {
        toast.success(t("toast-import-success"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("toast-import-error"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportDatabase = async (database: Workspace) => {
    const password = await askPassword("export");
    if (password === undefined) return; // cancelled
    try {
      await exportDatabase(database, password || undefined);
    } catch (err) {
      console.error(err);
      toast.error(t("toast-export-error"));
    }
  };

  const handleImportGedcom = async () => {
    const file = await pickFile(".ged,.gedcom");
    if (!file) return;
    try {
      setIsImporting(true);
      await importGedcom(file);
      toast.success(t("toast-gedcom-import-success"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-gedcom-import-error"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportGedcom = async (database: Workspace) => {
    try {
      await exportGedcom(database);
    } catch (err) {
      console.error(err);
      toast.error(t("toast-gedcom-export-error"));
    }
  };

  const handleStartRename = (database: Workspace) => {
    setEditingDatabaseId(database.id);
    setEditingName(database.name);
  };

  const handleCancelRename = () => {
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSaveRename = async (database: Workspace) => {
    if (!editingName.trim()) {
      toast.error(t("toast-rename-empty"));
      return;
    }
    try {
      await renameTree(database, editingName.trim());
      toast.success(t("toast-rename-success"));
      setEditingDatabaseId(null);
      setEditingName("");
    } catch (err) {
      console.error(err);
      toast.error(t("toast-rename-error"));
    }
  };

  const handleSelectDatabase = async (database: Workspace) => {
    if (selectedTree?.id !== database.id) {
      try {
        await selectTree(database);
      } catch {
        // Stale row — e.g. access was revoked since this list was loaded.
        toast.error(t("toast-select-error"));
      }
    }
  };

  const handleCopyId = async (database: Workspace) => {
    try {
      await navigator.clipboard.writeText(database.id);
      toast.success(t("toast-id-copied"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-id-copy-error"));
    }
  };

  const handleOpenRemoveDialog = async (database: Workspace) => {
    try {
      await selectTree(database);
    } catch {
      toast.error(t("toast-select-error"));
      return;
    }
    setIsRemoveDatabaseDialogOpen(true);
  };

  const ownedDatabases = workspaces.filter((d) => d.role === "owner");
  const sharedDatabases = workspaces.filter((d) => d.role !== "owner");

  const renderStatus = (database: Workspace, isSelected: boolean) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {isSelected && <Badge variant="success">{t("open-now")}</Badge>}
      {database.role === "owner" ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {database.shared_count && database.shared_count > 0 ? (
            <>
              <Users className="size-3.5" />
              {t("shared-with-count", { count: database.shared_count })}
            </>
          ) : (
            t("not-shared")
          )}
        </span>
      ) : (
        <Badge variant="info">{t(`role-${database.role}`)}</Badge>
      )}
    </div>
  );

  const renderActionsMenu = (database: Workspace) => {
    const isOwned = database.role === "owner";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("row-actions-button")}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOwned && (
            <DropdownMenuItem onSelect={() => setShareTree(database)}>
              <Share2 />
              {t("share-button")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDuplicateTree(database)}>
            <Copy />
            {t("duplicate-button")}
          </DropdownMenuItem>
          {database.role !== "viewer" && (
            <DropdownMenuItem
              disabled={editingDatabaseId !== null}
              onSelect={() => handleStartRename(database)}
            >
              <Edit2 />
              {t("rename-button")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void handleCopyId(database)}>
            <Copy />
            {t("copy-id-button")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void handleExportDatabase(database)}
          >
            <HardDriveUpload />
            {t("export-button")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void handleExportGedcom(database)}>
            <FileUp />
            {t("export-gedcom-button")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!isOwned}
            onSelect={() => void handleOpenRemoveDialog(database)}
          >
            <Trash2 />
            {t("delete-button")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderCard = (database: Workspace) => {
    const isOwned = database.role === "owner";
    const isSelected = selectedTree?.id === database.id;
    const isEditing = editingDatabaseId === database.id;
    return (
      <li key={database.id}>
        <Card
          data-slot="workspace-card"
          aria-current={isSelected ? "true" : undefined}
          className={cn(
            "h-full gap-4 px-5 transition-colors",
            isSelected
              ? "border-primary ring-1 ring-primary"
              : "hover:border-input",
          )}
        >
          <div className="flex items-start gap-3">
            <WorkspaceMonogram
              name={database.name}
              size="lg"
              muted={!isSelected}
            />
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-1">
                  <Input
                    size="sm"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleSaveRename(database);
                      } else if (e.key === "Escape") {
                        handleCancelRename();
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("rename-save")}
                    onClick={() => handleSaveRename(database)}
                  >
                    <Check />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("rename-cancel")}
                    onClick={handleCancelRename}
                  >
                    <X />
                  </Button>
                </div>
              ) : (
                <h3 className="truncate text-base font-bold">
                  {database.name}
                </h3>
              )}
              <div className="mt-1">{renderStatus(database, isSelected)}</div>
            </div>
            {renderActionsMenu(database)}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
            <span className="truncate text-xs text-muted-foreground">
              {database.created_at
                ? t("created-on", { date: formatDate(database.created_at) })
                : ""}
            </span>
            {isSelected ? (
              isOwned ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareTree(database)}
                >
                  <Share2 />
                  {t("share-button")}
                </Button>
              ) : null
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSelectDatabase(database)}
              >
                {t("open-button")}
              </Button>
            )}
          </div>
        </Card>
      </li>
    );
  };

  const renderSection = (
    heading: string,
    rows: Workspace[],
    emptyLabel: string,
    trailing?: React.ReactNode,
  ) => (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-tight">{heading}</span>
        <span className="text-xs font-semibold text-muted-foreground">
          {t("workspace-count", { count: rows.length })}
        </span>
      </h2>
      {rows.length === 0 && !trailing ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(renderCard)}
          {trailing}
        </ul>
      )}
    </section>
  );

  return (
    <ViewLayout
      title={t("title")}
      subtitle={t("subtitle")}
      // The scroller clips at its edge, so give the cards' selection and
      // focus rings room without shifting them out of line with the header.
      contentClassName="-mx-1 -mt-1 px-1 pt-1"
      action={
        <>
          <Button
            variant="outline"
            onClick={() => setIsMergeDialogOpen(true)}
            disabled={workspaces.length < 2}
          >
            <GitMerge />
            {t("merge-button")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-tutorial="import-menu">
                <HardDriveDownload />
                {t("import-menu-button")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleImportDatabase()}>
                <HardDriveDownload />
                {t("import-button")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleImportGedcom()}>
                <FileDown />
                {t("import-gedcom-button")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            data-tutorial="new-tree"
            onClick={() => setIsCreateDatabaseDialogOpen(true)}
          >
            <Plus />
            {t("new-workspace")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-8 pb-4">
        {isImporting && (
          <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-300 ease-in-out"
              style={{ width: `${importPct}%` }}
            />
          </div>
        )}
        {renderSection(
          t("owned-section"),
          ownedDatabases,
          t("no-owned"),
          <li>
            <button
              type="button"
              onClick={() => setIsCreateDatabaseDialogOpen(true)}
              className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="grid size-9 place-items-center rounded-full bg-muted">
                <Plus className="size-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">
                {t("new-card-title")}
              </span>
              <span className="max-w-60 text-xs">{t("new-card-body")}</span>
            </button>
          </li>,
        )}
        {renderSection(t("shared-section"), sharedDatabases, t("no-shared"))}
      </div>

      <CreateDatabaseDialog
        isOpen={isCreateDatabaseDialogOpen}
        onConfirm={() => setIsCreateDatabaseDialogOpen(false)}
        onCancel={() => setIsCreateDatabaseDialogOpen(false)}
      />
      <RemoveDatabaseDialog
        isOpen={isRemoveDatabaseDialogOpen}
        onConfirm={() => setIsRemoveDatabaseDialogOpen(false)}
        onCancel={() => setIsRemoveDatabaseDialogOpen(false)}
      />
      <MergeTreesDialog
        isOpen={isMergeDialogOpen}
        onClose={() => setIsMergeDialogOpen(false)}
      />
      <DuplicateTreeDialog
        tree={duplicateTree}
        onClose={() => setDuplicateTree(null)}
      />
      {shareTree && (
        <ShareTreeDialog
          tree={shareTree}
          isOpen={!!shareTree}
          onClose={() => {
            setShareTree(null);
            // Refresh so the owner's "Sharing" count reflects any changes.
            void loadTrees();
          }}
          onTreeUpdated={(updated) => setShareTree(updated)}
        />
      )}
      <PasswordDialog
        isOpen={!!passwordDialogState?.isOpen}
        mode={passwordDialogState?.mode || "export"}
        onConfirm={(password) => {
          passwordDialogState?.resolve(password);
          setPasswordDialogState(null);
        }}
        onCancel={() => {
          passwordDialogState?.resolve(undefined);
          setPasswordDialogState(null);
        }}
      />
    </ViewLayout>
  );
};
