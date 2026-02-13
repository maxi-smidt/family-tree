import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
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
  const { connect } = useDatabaseStore();

  const handleDatabaseChange = async (dbId: string) => {
    const db = databases.find((d) => d.id === dbId);
    if (db) {
      setSelectedDatabase(db);
      await connect(db);
    }
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
