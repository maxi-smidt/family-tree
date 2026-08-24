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
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useTranslation } from "react-i18next";
import { Crown, Layers, Users } from "lucide-react";
import { toast } from "sonner";

export const DatabaseSelector = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const virtualViews = useWorkspaceStore((s) => s.virtualViews);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const selectTree = useWorkspaceStore((s) => s.selectTree);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);

  const ownedTrees = workspaces.filter((db) => db.role === "owner");
  const sharedTrees = workspaces.filter((db) => db.role !== "owner");

  const handleDatabaseChange = (dbId: string) => {
    const item = [...workspaces, ...virtualViews].find((d) => d.id === dbId);
    if (item) {
      guardNavigate(() => {
        // Guards against a stale list entry — e.g. access was revoked since
        // this dropdown was last loaded — instead of leaving the store
        // half-connected to a tree it can no longer read (#807 follow-up).
        void selectTree(item).catch(() => toast.error(t("open-error")));
      });
    }
  };

  return (
    <SettingsField label={t("label")}>
      <Select
        onValueChange={handleDatabaseChange}
        value={selectedTree?.id ?? ""}
      >
        <SelectTrigger
          size="sm"
          className="w-full text-xs"
          data-testid="tree-selector"
        >
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {ownedTrees.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("your-workspaces-group")}</SelectLabel>
              {ownedTrees.map((db) => (
                <SelectItem key={db.id} value={db.id}>
                  <span className="flex items-center gap-2">
                    <Crown
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-label={t("owned")}
                    />
                    {db.name}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {sharedTrees.length > 0 && (
            <>
              {ownedTrees.length > 0 && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel>{t("shared-workspaces-group")}</SelectLabel>
                {sharedTrees.map((db) => (
                  <SelectItem key={db.id} value={db.id}>
                    <span className="flex items-center gap-2">
                      <Users
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label={t("shared")}
                      />
                      {db.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {virtualViews.length > 0 && (
            <>
              {workspaces.length > 0 && <SelectSeparator />}
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
