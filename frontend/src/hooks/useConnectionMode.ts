import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeMouseHandler } from "@xyflow/react";
import { Member } from "@/types/member";
import {
  findConnectionPathHighlight,
  pruneConnectionMemberIds,
} from "@/utils/graphUtils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const useConnectionMode = (
  members: Member[],
  onEnterConnectionMode?: () => void,
) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const [isConnectionMode, setIsConnectionMode] = useState(false);
  const [connectionMemberIds, setConnectionMemberIds] = useState<string[]>([]);
  const missingConnectionToastRef = useRef<string | null>(null);

  const connectionSelectedIds = useMemo(
    () => new Set(connectionMemberIds),
    [connectionMemberIds],
  );

  const connectionPath = useMemo(
    () =>
      findConnectionPathHighlight(
        members,
        isConnectionMode ? connectionMemberIds : [],
      ),
    [members, isConnectionMode, connectionMemberIds],
  );

  const hasConnectionPath =
    isConnectionMode && connectionPath.edgeKeys.size > 0;

  const missingConnectionSignature = useMemo(
    () =>
      connectionPath.missingPairs
        .map((pair) => `${pair.fromId}:${pair.toId}`)
        .join("|"),
    [connectionPath.missingPairs],
  );

  // Prune stale member IDs when members change.
  useEffect(() => {
    setConnectionMemberIds((currentIds) =>
      pruneConnectionMemberIds(currentIds, members),
    );
  }, [members]);

  // Show a toast when a connection path is missing or partial.
  useEffect(() => {
    if (
      !isConnectionMode ||
      connectionMemberIds.length < 2 ||
      !missingConnectionSignature
    ) {
      missingConnectionToastRef.current = null;
      return;
    }

    const toastSignature = `${connectionMemberIds.join(",")}:${missingConnectionSignature}`;
    if (missingConnectionToastRef.current === toastSignature) return;

    missingConnectionToastRef.current = toastSignature;
    toast.error(
      connectionPath.edgeKeys.size > 0
        ? t("connection-path-partial")
        : t("connection-path-not-found"),
    );
  }, [
    isConnectionMode,
    connectionMemberIds,
    missingConnectionSignature,
    connectionPath.edgeKeys.size,
    t,
  ]);

  const toggleConnectionMode = useCallback(() => {
    if (isConnectionMode) {
      setIsConnectionMode(false);
      setConnectionMemberIds([]);
      return;
    }

    onEnterConnectionMode?.();
    setIsConnectionMode(true);
  }, [isConnectionMode, onEnterConnectionMode]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!isConnectionMode || node.id.startsWith("union-")) return;
      event.stopPropagation();

      setConnectionMemberIds((currentIds) =>
        currentIds.includes(node.id)
          ? currentIds.filter((id) => id !== node.id)
          : [...currentIds, node.id],
      );
    },
    [isConnectionMode],
  );

  return {
    isConnectionMode,
    connectionMemberIds,
    connectionSelectedIds,
    connectionPath,
    hasConnectionPath,
    toggleConnectionMode,
    handleNodeClick,
  };
};
