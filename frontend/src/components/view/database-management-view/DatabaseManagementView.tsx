import { useState } from "react";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { pickFile, useDatabaseManager } from "@/hooks/useDatabaseManager";
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
} from "lucide-react";
import { CreateDatabaseDialog } from "@/components/shared/dialog/CreateDatabaseDialog";
import { RemoveDatabaseDialog } from "@/components/view/database-management-view/dialog/RemoveDatabaseDialog";
import { ShareTreeDialog } from "@/components/view/database-management-view/dialog/ShareTreeDialog";
import { PasswordDialog } from "@/components/shared/dialog/PasswordDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Database } from "@/types/database";
import { ViewLayout } from "@/components/layout/ViewLayout";

export const DatabaseManagementView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "database-management-view",
  });
  const databases = useDatabaseStore((s) => s.databases);
  const selectedDatabase = useDatabaseStore((s) => s.selectedDatabase);
  const selectDatabase = useDatabaseStore((s) => s.selectDatabase);
  const renameDatabase = useDatabaseStore((s) => s.renameDatabase);
  const { exportDatabase, importDatabase, inspectImport } =
    useDatabaseManager();

  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [isRemoveDatabaseDialogOpen, setIsRemoveDatabaseDialogOpen] =
    useState(false);
  const [shareTree, setShareTree] = useState<Database | null>(null);
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

  const handleExportDatabase = async (database: Database) => {
    const password = await askPassword("export");
    if (password === undefined) return; // cancelled
    try {
      await exportDatabase(database, password || undefined);
    } catch (err) {
      console.error(err);
      toast.error(t("toast-export-error"));
    }
  };

  const handleStartRename = (database: Database) => {
    setEditingDatabaseId(database.id);
    setEditingName(database.name);
  };

  const handleCancelRename = () => {
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSaveRename = async (database: Database) => {
    if (!editingName.trim()) {
      toast.error(t("toast-rename-empty"));
      return;
    }
    await renameDatabase(database, editingName.trim());
    toast.success(t("toast-rename-success"));
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSelectDatabase = async (database: Database) => {
    if (selectedDatabase?.id !== database.id) {
      await selectDatabase(database);
    }
  };

  const handleOpenRemoveDialog = async (database: Database) => {
    await selectDatabase(database);
    setIsRemoveDatabaseDialogOpen(true);
  };

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
        </div>
      }
    >
      <div className="flex-1 border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{t("table-name")}</TableHead>
              <TableHead>{t("table-id")}</TableHead>
              <TableHead className="text-right">{t("table-actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databases.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  {t("no-databases")}
                </TableCell>
              </TableRow>
            ) : (
              databases.map((database) => (
                <TableRow
                  key={database.id}
                  className={
                    selectedDatabase?.id === database.id ? "bg-muted" : ""
                  }
                >
                  <TableCell>
                    <input
                      type="radio"
                      checked={selectedDatabase?.id === database.id}
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelRename}
                        >
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {database.role === "owner" && (
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
                        disabled={database.role !== "owner"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground">
        {t("selected-label")}{" "}
        <span className="font-medium">
          {selectedDatabase?.name || t("none-selected")}
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
      {shareTree && (
        <ShareTreeDialog
          tree={shareTree}
          isOpen={!!shareTree}
          onClose={() => setShareTree(null)}
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
