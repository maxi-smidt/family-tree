import { useEffect } from "react";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { UnsavedChangesDialog } from "@/components/shared/dialog/UnsavedChangesDialog";

export const UnsavedChangesGuard = () => {
  const guards = useUnsavedChangesStore((s) => s.guards);
  const dialogOpen = useUnsavedChangesStore((s) => s.dialogOpen);
  const resolveStay = useUnsavedChangesStore((s) => s.resolveStay);
  const resolveDiscard = useUnsavedChangesStore((s) => s.resolveDiscard);
  const resolveSave = useUnsavedChangesStore((s) => s.resolveSave);

  const dirty = Object.keys(guards).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return (
    <UnsavedChangesDialog
      open={dialogOpen}
      onOpenChange={(open) => !open && resolveStay()}
      onStay={resolveStay}
      onSave={() => void resolveSave()}
      onDiscard={resolveDiscard}
    />
  );
};
