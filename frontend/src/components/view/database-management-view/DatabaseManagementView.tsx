import { useState } from "react";
import { useTreeStore } from "@/hooks/useTreeStore";
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
} from "lucide-react";
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
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const selectTree = useTreeStore((s) => s.selectTree);
  const renameTree = useTreeStore((s) => s.renameTree);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const { exportDatabase, importDatabase, inspectImport } = useTreeManager();

  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [isRemoveDatabaseDialogOpen, setIsRemoveDatabaseDialogOpen] =
    useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [duplicateTree, setDuplicateTree] = useState<Tree | null>(null);
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

      await importDatabase(file, password);
      toast.success(t("toast-import-success"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-import-error"));
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

  const handleOpenRemoveDialog = async (database: Tree) => {
    await selectTree(database);
    setIsRemoveDatabaseDialogOpen(true);
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
    return (
      <TableRow
        key={database.id}
        className={selectedTree?.id === database.id ? "bg-muted" : ""}
      >
        <TableCell>
          <input
            type="radio"
            checked={selectedTree?.id === database.id}
            onChange={() => handleSelectDatabase(database)}
            className="cursor-pointer"
          />
        </TableCell>
        <TableCell>
          {editingDatabaseId === database.id ? (
            <div className="flex items-center gap-2">
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
            <span className="font-medium">{database.name}</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground font-mono text-sm">
          {database.id}
        </TableCell>
        <TableCell>{renderStatusCell(database)}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            {isOwned && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShareTree(database)}
                title={t("share-button")}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDuplicateTree(database)}
              title={t("duplicate-button")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStartRename(database)}
              disabled={editingDatabaseId !== null}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExportDatabase(database)}
            >
              <HardDriveUpload className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenRemoveDialog(database)}
              disabled={!isOwned}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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
      <h3 className="text-sm font-semibold">{heading}</h3>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{t("table-name")}</TableHead>
              <TableHead>{t("table-id")}</TableHead>
              <TableHead>{statusHeader}</TableHead>
              <TableHead className="text-right">{t("table-actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateDatabaseDialogOpen(true)}
          >
            <Plus />
            {t("create-button")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportDatabase}>
            <HardDriveDownload />
            {t("import-button")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsMergeDialogOpen(true)}
            disabled={trees.length < 2}
          >
            <GitMerge />
            {t("merge-button")}
          </Button>
        </div>
      }
    >
      <div className="flex-1 flex flex-col gap-6 overflow-auto">
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
      {shareTree && (
        <ShareTreeDialog
          tree={shareTree}
          isOpen={!!shareTree}
          onClose={() => {
            setShareTree(null);
            // Refresh so the owner's "Sharing" count reflects any changes.
            void loadTrees();
          }}
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
