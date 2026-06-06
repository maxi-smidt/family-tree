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
import { Crown, Users } from "lucide-react";

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
              <span className="flex items-center gap-2">
                {db.role === "owner" ? (
                  <Crown
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-label={t("owned")}
                  />
                ) : (
                  <Users
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-label={t("shared")}
                  />
                )}
                {db.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsField>
  );
};
