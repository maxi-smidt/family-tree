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
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { WorkspaceMonogram } from "@/components/shared/WorkspaceMonogram";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Workspace } from "@/types/workspace";
import { toast } from "sonner";

/**
 * Switches the open workspace. `card` is the sidebar's switcher (name plus
 * role and people count); `header` is the bare "Monogram Name ▾" button the
 * phone tree shows in place of a page title. Both open the same list.
 */
export const DatabaseSelector = ({
  variant = "card",
}: {
  variant?: "card" | "header";
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.database-selector",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const selectTree = useWorkspaceStore((s) => s.selectTree);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);
  const totalMemberCount = useMemberStore((s) => s.totalMemberCount);

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
  const subtitle =
    selectedTree && totalMemberCount > 0
      ? `${roleLabel} · ${t("people", { count: totalMemberCount })}`
      : roleLabel;

  const renderItem = (db: Workspace) => (
    <SelectItem key={db.id} value={db.id} className="py-2 pl-2">
      <WorkspaceMonogram name={db.name} size="sm" muted />
      <span className="min-w-0 flex-1 truncate">{db.name}</span>
      {db.role && db.role !== "owner" && (
        <span className="text-xs text-muted-foreground">
          {t(`role-${db.role}`)}
        </span>
      )}
    </SelectItem>
  );

  return (
    <Select onValueChange={handleDatabaseChange} value={selectedTree?.id ?? ""}>
      {variant === "header" ? (
        <SelectTrigger
          className="h-11 max-w-full min-w-0 gap-2.5 border-0 bg-transparent px-1 text-left shadow-none data-[size=default]:h-11 hover:bg-accent dark:bg-transparent dark:hover:bg-accent"
          data-testid="tree-selector-header"
          aria-label={t("switch")}
          icon={<ChevronDown className="size-4 opacity-60" />}
        >
          <WorkspaceMonogram name={selectedTree?.name} size="md" />
          <span className="truncate text-base font-semibold text-foreground">
            {selectedTree?.name ?? t("placeholder")}
          </span>
        </SelectTrigger>
      ) : (
        <SelectTrigger
          className="h-auto w-full gap-3 rounded-xl data-[size=default]:h-auto border-sidebar-border bg-card px-2.5 py-2.5 text-left shadow-xs hover:border-input dark:bg-card"
          data-testid="tree-selector"
          title={t("switch")}
          icon={<ChevronsUpDown className="size-4 opacity-60" />}
        >
          <WorkspaceMonogram name={selectedTree?.name} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm leading-5 font-semibold text-foreground">
              {selectedTree?.name ?? t("placeholder")}
            </span>
            <span className="truncate text-xs leading-4 text-muted-foreground">
              {subtitle}
            </span>
          </span>
        </SelectTrigger>
      )}
      <SelectContent
        position="popper"
        sideOffset={6}
        className={
          variant === "header"
            ? "min-w-72"
            : "w-(--radix-select-trigger-width) min-w-64"
        }
      >
        {ownedTrees.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("your-workspaces-group")}</SelectLabel>
            {ownedTrees.map(renderItem)}
          </SelectGroup>
        )}
        {sharedTrees.length > 0 && (
          <>
            {ownedTrees.length > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>{t("shared-workspaces-group")}</SelectLabel>
              {sharedTrees.map(renderItem)}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
};
