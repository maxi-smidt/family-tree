import { useCallback, useState } from "react";

/**
 * Add or remove a single id from a selection set — the primitive behind
 * click-to-toggle in selection mode. Returns a new Set and never mutates the
 * input.
 */
export const toggleSelectionId = (
  selectedIds: Iterable<string>,
  id: string,
): Set<string> => {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
};

export const useSelectionMode = (onEnterSelectionMode?: () => void) => {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const toggleSelectionMode = useCallback(() => {
    if (isSelectionMode) {
      setIsSelectionMode(false);
      return;
    }

    onEnterSelectionMode?.();
    setIsSelectionMode(true);
  }, [isSelectionMode, onEnterSelectionMode]);
  return { isSelectionMode, toggleSelectionMode };
};
