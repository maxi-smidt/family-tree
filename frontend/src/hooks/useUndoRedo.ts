import { useEffect } from "react";
import { useMemberStore } from "@/hooks/useMemberStore";

export const useUndoRedo = (enabled = true) => {
  const undo = useMemberStore((s) => s.undo);
  const redo = useMemberStore((s) => s.redo);
  const undoStack = useMemberStore((s) => s.undoStack);
  const redoStack = useMemberStore((s) => s.redoStack);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      const meta = e.ctrlKey || e.metaKey;
      if (!enabled) return;
      if (!meta) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (undoStack.length > 0) undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        if (redoStack.length > 0) redo();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, undo, redo, undoStack, redoStack]);
};
