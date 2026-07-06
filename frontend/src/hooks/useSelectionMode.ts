import { useCallback, useState } from "react";

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
