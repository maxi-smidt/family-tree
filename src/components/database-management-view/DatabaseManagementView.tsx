import { useState } from "react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useDatabaseManager } from "@/hooks/useDatabaseManager";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
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
  Check,
  X,
} from "lucide-react";
import { CreateDatabaseDialog } from "@/components/dialog/CreateDatabaseDialog";
import { RemoveDatabaseDialog } from "@/components/dialog/RemoveDatabaseDialog";
import { ImportDatabaseDialog } from "@/components/dialog/ImportDatabaseDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Database } from "@/types/database";

export const DatabaseManagementView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "database-management-view",
  });
  const databases = useFamilyTreeSettings((s) => s.databases);
  const selectedDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const addDatabase = useFamilyTreeSettings((s) => s.addDatabase);
  const { connect } = useDatabaseStore();
  const { exportDatabase, importDatabase, importDatabaseCheck } =
    useDatabaseManager();

  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [isRemoveDatabaseDialogOpen, setIsRemoveDatabaseDialogOpen] =
    useState(false);
  const [importConfirmState, setImportConfirmState] = useState<{
    isOpen: boolean;
    resolve: (choice: "overwrite" | "keep" | "cancel") => void;
  } | null>(null);
  const [editingDatabaseId, setEditingDatabaseId] = useState<string | null>(
    null,
  );
  const [editingName, setEditingName] = useState("");
  const [previousSelectedDb, setPreviousSelectedDb] = useState<
    Database | undefined
  >(undefined);

  const askImportHandling = () => {
    return new Promise<"overwrite" | "keep" | "cancel">((resolve) => {
      setImportConfirmState({ isOpen: true, resolve });
    });
  };

  const handleImportDatabase = async () => {
    const check = await importDatabaseCheck();
    if (!check) return;

    let overwrite = false;
    if (check.collision) {
      const choice = await askImportHandling();
      if (choice === "cancel") return;
      overwrite = choice === "overwrite";
    }

    try {
      if (check.collision && overwrite) {
        const familyStore = useDatabaseStore.getState();
        if (selectedDatabase?.id === check.collision.id) {
          await familyStore.disconnect();
        }
      }

      const newDatabase = await importDatabase(check.sourcePath, overwrite);

      setSelectedDatabase(newDatabase);
      await connect(newDatabase);
      toast.success(t("toast-import-success"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-import-error"));
    }
  };

  const handleExportDatabase = (database: Database) => {
    exportDatabase(database);
  };

  const handleStartRename = (database: Database) => {
    setEditingDatabaseId(database.id);
    setEditingName(database.name);
  };

  const handleCancelRename = () => {
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSaveRename = (database: Database) => {
    if (!editingName.trim()) {
      toast.error(t("toast-rename-empty"));
      return;
    }

    const updatedDatabase = { ...database, name: editingName.trim() };
    addDatabase(updatedDatabase);

    if (selectedDatabase?.id === database.id) {
      setSelectedDatabase(updatedDatabase);
    }

    toast.success(t("toast-rename-success"));
    setEditingDatabaseId(null);
    setEditingName("");
  };

  const handleSelectDatabase = async (database: Database) => {
    if (selectedDatabase?.id !== database.id) {
      setSelectedDatabase(database);
      await connect(database);
    }
  };

  const handleOpenRemoveDialog = (database: Database) => {
    setPreviousSelectedDb(selectedDatabase);
    setSelectedDatabase(database);
    setIsRemoveDatabaseDialogOpen(true);
  };

  const handleCancelRemove = () => {
    if (previousSelectedDb && previousSelectedDb.id !== selectedDatabase?.id) {
      setSelectedDatabase(previousSelectedDb);
    }
    setPreviousSelectedDb(undefined);
    setIsRemoveDatabaseDialogOpen(false);
  };

  const handleConfirmRemove = () => {
    setPreviousSelectedDb(undefined);
    setIsRemoveDatabaseDialogOpen(false);
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateDatabaseDialogOpen(true)}
          >
            <Plus className="mr-2" />
            {t("create-button")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportDatabase}>
            <HardDriveDownload className="mr-2" />
            {t("import-button")}
          </Button>
        </div>
      </div>

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
                              handleSaveRename(database);
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
        onConfirm={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
      <ImportDatabaseDialog
        isOpen={!!importConfirmState?.isOpen}
        onChoice={(choice) => {
          importConfirmState?.resolve(choice);
          setImportConfirmState(null);
        }}
      />
    </div>
  );
};
