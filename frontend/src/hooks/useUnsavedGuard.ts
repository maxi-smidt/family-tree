import { useCallback, useEffect, useRef } from "react";
import { useUnsavedChangesStore } from "./useUnsavedChangesStore";

export const useUnsavedGuard = (
  id: string,
  isDirty: boolean,
  requestSave: () => Promise<boolean>,
) => {
  const { register, unregister } = useUnsavedChangesStore();
  const saveRef = useRef(requestSave);
  saveRef.current = requestSave;

  const stableGuard = useCallback(
    () => ({ requestSave: () => saveRef.current() }),
    [],
  );

  useEffect(() => {
    if (isDirty) {
      register(id, stableGuard());
    } else {
      unregister(id);
    }
    return () => unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, id]);
};
