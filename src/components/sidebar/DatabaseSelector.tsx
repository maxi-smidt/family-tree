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

export const DatabaseSelector = () => {
  const databases = useFamilyTreeSettings((s) => s.databases);
  const selectedDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
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

  return (
    <SettingsField label="Active Database">
      <div className="flex flex-col gap-2">
        <Select
          onValueChange={(e) =>
            setSelectedDatabase(databases.find((d) => d.id === e)!)
          }
          value={selectedDatabase?.id ?? ""}
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            value={selectedDatabase?.id ?? ""}
          >
            <SelectValue placeholder="Select database" />
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
            Database
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            onClick={() => setIsRemoveDatabaseDialogOpen(true)}
            disabled={databases.length < 1}
          >
            <Minus />
            Database
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
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            disabled={!selectedDatabase}
            onClick={() => exportDatabase(selectedDatabase!)}
          >
            <HardDriveUpload />
            Export
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
      toast.success("Database imported successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to import database.");
    }
  }
};
