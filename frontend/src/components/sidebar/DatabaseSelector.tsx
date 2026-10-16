import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useTranslation } from "react-i18next";
import { Crown, Users } from "lucide-react";
import { toast } from "sonner";

export const DatabaseSelector = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const selectTree = useWorkspaceStore((s) => s.selectTree);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);

  const ownedTrees = workspaces.filter((db) => db.role === "owner");
  const sharedTrees = workspaces.filter((db) => db.role !== "owner");

  const handleDatabaseChange = (dbId: string) => {
    const item = workspaces.find((d) => d.id === dbId);
    if (item) {
      guardNavigate(() => {
        // Guards against a stale list entry — e.g. access was revoked since
        // this dropdown was last loaded — instead of leaving the store
        // half-connected to a tree it can no longer read (#807 follow-up).
        void selectTree(item).catch(() => toast.error(t("open-error")));
      });
    }
  };

  const roleLabel = selectedTree?.role
    ? t(`role-${selectedTree.role}`)
    : t("none");
  const monogram = selectedTree?.name?.trim().charAt(0).toUpperCase() || "·";

  return (
    <Select onValueChange={handleDatabaseChange} value={selectedTree?.id ?? ""}>
      <SelectTrigger
        className="h-auto w-full gap-2.5 rounded-xl border-sidebar-border bg-card p-2 text-left shadow-xs hover:border-input dark:bg-card"
        data-testid="tree-selector"
        title={t("switch")}
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground"
        >
          {monogram}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {selectedTree?.name ?? t("placeholder")}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {roleLabel}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="w-(--radix-select-trigger-width)"
      >
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
      </SelectContent>
    </Select>
  );
};
