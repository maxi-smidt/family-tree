import { useState } from "react";
import { useJobStore } from "@/hooks/useJobStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useFeature } from "@/hooks/useAuthStore";
import { pickFile, useTreeManager } from "@/hooks/useTreeManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Hash,
  FileUp,
  FileDown,
  Layers,
  AlertTriangle,
  RefreshCw,
  MoreHorizontal,
  Scissors,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateDatabaseDialog } from "@/components/shared/dialog/CreateDatabaseDialog";
import { RemoveDatabaseDialog } from "@/components/view/database-management-view/dialog/RemoveDatabaseDialog";
import { ShareTreeDialog } from "@/components/view/database-management-view/dialog/ShareTreeDialog";
import { MergeTreesDialog } from "@/components/view/database-management-view/dialog/MergeTreesDialog";
import { DuplicateTreeDialog } from "@/components/view/database-management-view/dialog/DuplicateTreeDialog";
import { ExtractSubtreeDialog } from "@/components/view/database-management-view/dialog/ExtractSubtreeDialog";
import { VirtualViewDialog } from "@/components/view/database-management-view/dialog/VirtualViewDialog";
import { PasswordDialog } from "@/components/shared/dialog/PasswordDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Tree } from "@/types/tree";
import { ViewLayout } from "@/components/layout/ViewLayout";

export const DatabaseManagementView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "database-management-view",
  });
  const trees = useTreeStore((s) => s.trees);
  const virtualViews = useTreeStore((s) => s.virtualViews);
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const selectTree = useTreeStore((s) => s.selectTree);
  const renameTree = useTreeStore((s) => s.renameTree);
  const deleteVirtualView = useTreeStore((s) => s.deleteVirtualView);
  const renameVirtualView = useTreeStore((s) => s.renameVirtualView);
  const recomputeMatches = useTreeStore((s) => s.recomputeMatches);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const {
    exportDatabase,
    importDatabase,
    inspectImport,
    exportGedcom,
    importGedcom,
  } = useTreeManager();
  const gedcomEnabled = useFeature("gedcom");
  const virtualViewsEnabled = useFeature("virtual_views");
  const [isImporting, setIsImporting] = useState(false);
  const importPct = useJobStore((s) => s.activeJobPct);

  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [isRemoveDatabaseDialogOpen, setIsRemoveDatabaseDialogOpen] =
    useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [isVirtualViewDialogOpen, setIsVirtualViewDialogOpen] = useState(false);
  const [editingVirtualView, setEditingVirtualView] = useState<Tree | null>(
    null,
  );
  const [duplicateTree, setDuplicateTree] = useState<Tree | null>(null);
  const [extractTree, setExtractTree] = useState<Tree | null>(null);
  const [shareTree, setShareTree] = useState<Tree | null>(null);
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

  const handleExportDatabase = async (database: Tree) => {
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

  const handleExportGedcom = async (database: Tree) => {
    try {
      await exportGedcom(database);
    } catch (err) {
      console.error(err);
      toast.error(t("toast-gedcom-export-error"));
    }
  };

  const handleStartRename = (database: Tree) => {
    setEditingDatabaseId(database.id);
    setEditingName(database.name);
  };

  const handleCancelRename = () => {
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSaveRename = async (database: Tree) => {
    if (!editingName.trim()) {
      toast.error(t("toast-rename-empty"));
      return;
    }
    await renameTree(database, editingName.trim());
    toast.success(t("toast-rename-success"));
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSelectDatabase = async (database: Tree) => {
    if (selectedTree?.id !== database.id) {
      await selectTree(database);
    }
  };

  const handleCopyId = async (database: Tree) => {
    try {
      await navigator.clipboard.writeText(database.id);
      toast.success(t("toast-id-copied"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-id-copy-error"));
    }
  };

  const handleOpenRemoveDialog = async (database: Tree) => {
    await selectTree(database);
    setIsRemoveDatabaseDialogOpen(true);
  };

  const handleDeleteVirtualView = async (view: Tree) => {
    await deleteVirtualView(view);
    toast.success(t("toast-virtual-view-deleted"));
  };

  const handleRecomputeMatches = async (view: Tree) => {
    try {
      const { mergedMemberCount } = await recomputeMatches(view);
      toast.success(t("toast-recompute-success", { count: mergedMemberCount }));
    } catch {
      toast.error(t("toast-recompute-error"));
    }
  };

  const handleSelectVirtualView = async (view: Tree) => {
    if (selectedTree?.id !== view.id) {
      await selectTree(view);
    }
  };

  const handleRenameVirtualView = async (view: Tree, name: string) => {
    if (!name.trim()) {
      toast.error(t("toast-rename-empty"));
      return;
    }
    await renameVirtualView(view, name.trim());
    toast.success(t("toast-rename-success"));
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const ownedDatabases = trees.filter((d) => d.role === "owner");
  const sharedDatabases = trees.filter((d) => d.role !== "owner");

  const renderStatusCell = (database: Tree) => {
    if (database.role === "owner") {
      if (database.shared_count && database.shared_count > 0) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="gap-1">
                <Users className="h-3 w-3" />
                {database.shared_count}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {t("shared-with-count", { count: database.shared_count })}
            </TooltipContent>
          </Tooltip>
        );
      }
      return (
        <span className="text-muted-foreground text-sm">{t("not-shared")}</span>
      );
    }
    return <Badge variant="outline">{t(`role-${database.role}`)}</Badge>;
  };

  const renderRow = (database: Tree) => {
    const isOwned = database.role === "owner";
    const isSelected = selectedTree?.id === database.id;
    return (
      <TableRow
        key={database.id}
        onClick={() => handleSelectDatabase(database)}
        className={`group cursor-pointer ${isSelected ? "bg-muted" : ""}`}
      >
        <TableCell
          className={
            isSelected
              ? "border-l-2 border-l-primary"
              : "border-l-2 border-l-transparent"
          }
        >
          <input
            type="radio"
            checked={isSelected}
            onChange={() => handleSelectDatabase(database)}
            className="cursor-pointer"
            aria-label={t("select-tree")}
          />
        </TableCell>
        <TableCell>
          {editingDatabaseId === database.id ? (
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="h-8"
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
                size="sm"
                onClick={() => handleSaveRename(database)}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancelRename}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{database.name}</span>
              {isSelected && (
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit font-mono"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopyId(database);
                  }}
                  title={t("copy-id-button")}
                  aria-label={t("copy-id-button")}
                >
                  <Hash className="size-3 shrink-0" />
                  {database.id}
                </button>
              )}
            </div>
          )}
        </TableCell>
        <TableCell>{renderStatusCell(database)}</TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("row-actions-button")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwned && (
                  <DropdownMenuItem onSelect={() => setShareTree(database)}>
                    <Share2 className="h-4 w-4" />
                    {t("share-button")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setDuplicateTree(database)}>
                  <Copy className="h-4 w-4" />
                  {t("duplicate-button")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setExtractTree(database)}>
                  <Scissors className="h-4 w-4" />
                  {t("extract-subtree-button")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={editingDatabaseId !== null}
                  onSelect={() => handleStartRename(database)}
                >
                  <Edit2 className="h-4 w-4" />
                  {t("rename-button")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleExportDatabase(database)}
                >
                  <HardDriveUpload className="h-4 w-4" />
                  {t("export-button")}
                </DropdownMenuItem>
                {gedcomEnabled && (
                  <DropdownMenuItem
                    onSelect={() => void handleExportGedcom(database)}
                  >
                    <FileUp className="h-4 w-4" />
                    {t("export-gedcom-button")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!isOwned}
                  onSelect={() => void handleOpenRemoveDialog(database)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("delete-button")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const renderSection = (
    heading: string,
    rows: Tree[],
    emptyLabel: string,
    statusHeader: string,
  ) => (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {heading}{" "}
        <span className="text-muted-foreground font-normal">
          ({rows.length})
        </span>
      </h3>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{t("table-name")}</TableHead>
              <TableHead>{statusHeader}</TableHead>
              <TableHead className="text-right">{t("table-actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(renderRow)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <ViewLayout
      title={t("title")}
      action={
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-tutorial="new-tree">
                <Plus className="h-4 w-4" />
                {t("new-menu-button")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setIsCreateDatabaseDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                {t("create-button")}
              </DropdownMenuItem>
              {virtualViewsEnabled && (
                <DropdownMenuItem
                  disabled={trees.length < 2}
                  onSelect={() => {
                    setEditingVirtualView(null);
                    setIsVirtualViewDialogOpen(true);
                  }}
                >
                  <Layers className="h-4 w-4" />
                  {t("virtual-view-button")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-tutorial="import-menu">
                <HardDriveDownload className="h-4 w-4" />
                {t("import-menu-button")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleImportDatabase()}>
                <HardDriveDownload className="h-4 w-4" />
                {t("import-button")}
              </DropdownMenuItem>
              {gedcomEnabled && (
                <DropdownMenuItem onSelect={() => void handleImportGedcom()}>
                  <FileDown className="h-4 w-4" />
                  {t("import-gedcom-button")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsMergeDialogOpen(true)}
            disabled={trees.length < 2}
          >
            <GitMerge className="h-4 w-4" />
            {t("merge-button")}
          </Button>
        </div>
      }
    >
      <div className="flex-1 flex flex-col gap-6 overflow-auto">
        {isImporting && (
          <div className="h-2 rounded-full bg-muted overflow-hidden">
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
          t("table-sharing"),
        )}
        {renderSection(
          t("shared-section"),
          sharedDatabases,
          t("no-shared"),
          t("table-your-role"),
        )}
        {virtualViewsEnabled && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t("virtual-views-section")}{" "}
              <span className="text-muted-foreground font-normal">
                ({virtualViews.length})
              </span>
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>{t("table-name")}</TableHead>
                    <TableHead>{t("table-sources")}</TableHead>
                    <TableHead className="text-right">
                      {t("table-actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {virtualViews.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-muted-foreground"
                      >
                        {t("no-virtual-views")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    virtualViews.map((view) => {
                      const isSelected = selectedTree?.id === view.id;
                      const hasInaccessible = view.sources?.some(
                        (s) => !s.accessible,
                      );
                      return (
                        <TableRow
                          key={view.id}
                          onClick={() => handleSelectVirtualView(view)}
                          className={`group cursor-pointer ${isSelected ? "bg-muted" : ""}`}
                        >
                          <TableCell
                            className={
                              isSelected
                                ? "border-l-2 border-l-primary"
                                : "border-l-2 border-l-transparent"
                            }
                          >
                            <input
                              type="radio"
                              checked={isSelected}
                              onChange={() => handleSelectVirtualView(view)}
                              className="cursor-pointer"
                              aria-label={t("select-tree")}
                            />
                          </TableCell>
                          <TableCell>
                            {editingDatabaseId === view.id ? (
                              <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Input
                                  value={editingName}
                                  onChange={(e) =>
                                    setEditingName(e.target.value)
                                  }
                                  className="h-8"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      void handleRenameVirtualView(
                                        view,
                                        editingName,
                                      );
                                    } else if (e.key === "Escape") {
                                      handleCancelRename();
                                    }
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleRenameVirtualView(view, editingName)
                                  }
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleCancelRename}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 font-medium">
                                <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                                {view.name}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {view.sources?.map((src) => (
                                <Tooltip key={src.tree_id}>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant={
                                        src.accessible ? "secondary" : "outline"
                                      }
                                      className="gap-1"
                                    >
                                      {!src.accessible && (
                                        <AlertTriangle className="h-3 w-3 text-destructive" />
                                      )}
                                      {src.is_virtual && (
                                        <Layers className="h-3 w-3" />
                                      )}
                                      {src.tree_name}
                                    </Badge>
                                  </TooltipTrigger>
                                  {!src.accessible && (
                                    <TooltipContent>
                                      {t("source-inaccessible")}
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              ))}
                              {hasInaccessible && (
                                <span className="text-xs text-destructive self-center">
                                  {t("view-degraded")}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("row-actions-button")}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditingVirtualView(view);
                                      setIsVirtualViewDialogOpen(true);
                                    }}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                    {t("edit-sources-button")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleRecomputeMatches(view)
                                    }
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                    {t("recompute-button")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={editingDatabaseId !== null}
                                    onSelect={() => handleStartRename(view)}
                                  >
                                    <Hash className="h-4 w-4" />
                                    {t("rename-button")}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleDeleteVirtualView(view)
                                    }
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t("delete-virtual-view-button")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {t("selected-label")}{" "}
        <span className="font-medium">
          {selectedTree?.name || t("none-selected")}
        </span>
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
      <ExtractSubtreeDialog
        tree={extractTree}
        onClose={() => setExtractTree(null)}
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
      <VirtualViewDialog
        isOpen={isVirtualViewDialogOpen}
        onClose={() => {
          setIsVirtualViewDialogOpen(false);
          setEditingVirtualView(null);
        }}
        view={editingVirtualView}
      />
    </ViewLayout>
  );
};
