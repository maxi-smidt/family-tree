import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { useTranslation } from "react-i18next";

export const DatabaseSelector = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const databases = useDatabaseStore((s) => s.databases);
  const selectedDatabase = useDatabaseStore((s) => s.selectedDatabase);
  const selectDatabase = useDatabaseStore((s) => s.selectDatabase);

  const handleDatabaseChange = async (dbId: string) => {
    const db = databases.find((d) => d.id === dbId);
    if (db) await selectDatabase(db);
  };

  return (
    <SettingsField label={t("label")}>
      <Select
        onValueChange={handleDatabaseChange}
        value={selectedDatabase?.id ?? ""}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
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
    </SettingsField>
  );
};
