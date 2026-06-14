import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useTranslation } from "react-i18next";
import { Crown, Layers, Users } from "lucide-react";

export const DatabaseSelector = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const trees = useTreeStore((s) => s.trees);
  const virtualViews = useTreeStore((s) => s.virtualViews);
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const selectTree = useTreeStore((s) => s.selectTree);

  const handleDatabaseChange = async (dbId: string) => {
    const item =
      [...trees, ...virtualViews].find((d) => d.id === dbId);
    if (item) await selectTree(item);
  };

  return (
    <SettingsField label={t("label")}>
      <Select
        onValueChange={handleDatabaseChange}
        value={selectedTree?.id ?? ""}
      >
        <SelectTrigger size="sm" className="w-full text-xs" data-testid="tree-selector">
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{t("trees-group")}</SelectLabel>
            {trees.map((db) => (
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
          </SelectGroup>
          {virtualViews.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t("virtual-views-group")}</SelectLabel>
                {virtualViews.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="flex items-center gap-2">
                      <Layers
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label={t("virtual-view")}
                      />
                      {v.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
    </SettingsField>
  );
};
