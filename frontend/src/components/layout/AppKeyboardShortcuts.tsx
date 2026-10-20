import { lazy, Suspense, useEffect, useState } from "react";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { TREE_VIEW } from "@/lib/tabs";
import { canEditArea } from "@/utils/accessLevels";
import {
  activeDialog,
  isTyping,
  NEW_PERSON_EVENT,
  saveActivePanel,
} from "@/lib/keyboardShortcuts";

const NewPersonSheet = lazy(
  () => import("@/components/shared/member-sheet/NewPersonSheet"),
);

export function AppKeyboardShortcuts({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const workspace = useWorkspaceStore((s) => s.selectedTree);
  const isReady = useWorkspaceStore((s) => s.isReady);
  const [newPersonWorkspaceId, setNewPersonWorkspaceId] = useState<
    string | null
  >(null);

  useEffect(() => setNewPersonWorkspaceId(null), [workspace?.id]);

  useEffect(() => {
    const openNewPerson = () => {
      const dialog = activeDialog();
      if (
        enabled &&
        workspace &&
        isReady &&
        canEditArea(workspace, "tree") &&
        dialog?.getAttribute("role") !== "alertdialog" &&
        !dialog?.hasAttribute("data-new-person")
      ) {
        useUnsavedChangesStore.getState().guardNavigate(() => {
          if (useWorkspaceStore.getState().selectedTree?.id !== workspace.id)
            return;
          useNavigationStore.getState().navigateTo(TREE_VIEW);
          useUserSettingsViewStore.getState().closeSettings();
          useAdminViewStore.getState().closeAdmin();
          setNewPersonWorkspaceId(workspace.id);
        });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const key = event.key.toLowerCase();
      const save = key === "s" && (event.metaKey || event.ctrlKey);
      const newPerson =
        key === "enter" &&
        (event.metaKey || event.ctrlKey) &&
        !isTyping(event.target) &&
        !activeDialog();
      if (!save && !newPerson) return;
      event.preventDefault();
      if (event.repeat) return;
      if (save) {
        saveActivePanel(event.target);
      } else openNewPerson();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(NEW_PERSON_EVENT, openNewPerson);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(NEW_PERSON_EVENT, openNewPerson);
    };
  }, [enabled, workspace, isReady]);

  return enabled &&
    workspace &&
    newPersonWorkspaceId === workspace.id &&
    canEditArea(workspace, "tree") ? (
    <Suspense fallback={null}>
      <NewPersonSheet
        key={workspace.id}
        onClose={() => setNewPersonWorkspaceId(null)}
      />
    </Suspense>
  ) : null;
}
