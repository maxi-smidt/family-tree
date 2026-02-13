import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";
import { HardDriveDownload, HardDriveUpload, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { CreateDatabaseDialog } from "@/components/dialog/CreateDatabaseDialog";
import { useState } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import { RemoveDatabaseDialog } from "@/components/dialog/RemoveDatabaseDialog";
import { toast } from "sonner";
import { useDatabaseManager } from "@/hooks/useDatabaseManager";
import { ImportDatabaseDialog } from "@/components/dialog/ImportDatabaseDialog";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useTranslation } from "react-i18next";

export const DatabaseSelector = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const databases = useFamilyTreeSettings((s) => s.databases);
  const selectedDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const { connect } = useFamilyStore();
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

  const askImportHandling = () => {
    return new Promise<"overwrite" | "keep" | "cancel">((resolve) => {
      setImportConfirmState({ isOpen: true, resolve });
    });
  };

  const handleDatabaseChange = async (dbId: string) => {
    const db = databases.find((d) => d.id === dbId);
    if (db) {
      setSelectedDatabase(db);
      await connect(db);
    }
  };

  return (
    <SettingsField label={t("label")}>
      <div className="flex flex-col gap-2">
        <Select
          onValueChange={handleDatabaseChange}
          value={selectedDatabase?.id ?? ""}
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            value={selectedDatabase?.id ?? ""}
          >
            <SelectValue placeholder={t("placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.id} value={db.id}>
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ButtonGroup className="w-full">
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            onClick={() => setIsCreateDatabaseDialogOpen(true)}
          >
            <Plus />
            {t("database")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            onClick={() => setIsRemoveDatabaseDialogOpen(true)}
            disabled={databases.length < 1}
          >
            <Minus />
            {t("database")}
          </Button>
        </ButtonGroup>

        <ButtonGroup className="w-full">
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            onClick={handleImportDatabase}
          >
            <HardDriveDownload />
            {t("import")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            disabled={!selectedDatabase}
            onClick={() => exportDatabase(selectedDatabase!)}
          >
            <HardDriveUpload />
            {t("export")}
          </Button>
        </ButtonGroup>
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
      <ImportDatabaseDialog
        isOpen={!!importConfirmState?.isOpen}
        onChoice={(choice) => {
          importConfirmState?.resolve(choice);
          setImportConfirmState(null);
        }}
      />
    </SettingsField>
  );

  async function handleImportDatabase() {
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
        const familyStore = useFamilyStore.getState();
        if (selectedDatabase?.id === check.collision.id) {
          await familyStore.disconnect(check.collision);
        }
      }

      const newDatabase = await importDatabase(check.sourcePath, overwrite);

      setSelectedDatabase(newDatabase);
      await connect(newDatabase);
      toast.success(t("toast-success"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-error"));
    }
  }
};
