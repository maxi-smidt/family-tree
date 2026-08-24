import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";

/**
 * Workspace-in-tree breadcrumb. Shows the ancestor chain when the user has followed
 * one or more member→tree links, letting them jump back to any tree they came
 * from. Hidden entirely when viewing a top-level tree.
 */
export const WorkspaceBreadcrumb = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.tree-breadcrumb",
  });
  const stack = useWorkspaceStore((s) => s.workspaceNavStack);
  const current = useWorkspaceStore((s) => s.selectedTree);
  const navigateToTreeStack = useWorkspaceStore((s) => s.navigateToTreeStack);

  if (stack.length === 0) return null;

  return (
    <nav
      aria-label={t("aria-label")}
      className="ml-16 mr-4 mt-2 flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground"
    >
      {stack.map((entry, index) => (
        <span key={`${entry.id}-${index}`} className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void navigateToTreeStack(index)}
            className="max-w-[12rem] truncate hover:text-foreground hover:underline"
          >
            {entry.name || t("untitled")}
          </button>
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
        </span>
      ))}
      <span className="max-w-[12rem] shrink-0 truncate font-medium text-foreground">
        {current?.name || t("untitled")}
      </span>
    </nav>
  );
};
