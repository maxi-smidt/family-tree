import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingField } from "@/components/sidebar/SettingsField";
import { HardDriveDownload, HardDriveUpload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings.ts";
import { CreateDatabaseDialog } from "@/components/dialog/CreateDatabaseDialog.tsx";
import { useState } from "react";

export const DatabaseSelector = () => {
  const databases = useFamilyTreeSettings((s) => s.databases);
  const selectedDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <SettingField label="Active Database">
      <div className="flex flex-col gap-2">
        <Select>
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            value={selectedDatabase.id}
          >
            <SelectValue placeholder="Select database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem value={db.id}>{db.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus />
          New Database
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="text-xs">
            <HardDriveDownload />
            Import
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            <HardDriveUpload />
            Export
          </Button>
        </div>
      </div>
      <CreateDatabaseDialog
        isOpen={isDialogOpen}
        onConfirm={() => {}}
        onCancel={() => setIsDialogOpen(false)}
      />
    </SettingField>
  );
};
