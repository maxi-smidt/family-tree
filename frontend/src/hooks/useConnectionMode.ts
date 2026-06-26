import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeMouseHandler } from "@xyflow/react";
import { Member } from "@/types/member";
import {
  classifyKinship,
  findConnectionPathHighlight,
  pruneConnectionMemberIds,
} from "@/utils/graphUtils";
import { formatKinship } from "@/utils/kinship";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export interface ConnectionRelation {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  /** Localised kinship noun, e.g. "grandmother". */
  label: string;
}

export const useConnectionMode = (
  members: Member[],
  onEnterConnectionMode?: () => void,
) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { t: tKinship } = useTranslation();
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

  /**
   * Derived kinship labels for every ordered pair of selected members that
   * are connected (both appear in connectionPath.nodeIds) and have a
   * translatable kinship noun.
   *
   * We emit ordered pairs (fromId → toId) so the sentence "A is the X of B"
   * can be read naturally. Two members selected will yield two entries if the
   * relationship noun differs by direction (e.g. parent vs child).
   */
  const connectionRelations = useMemo((): ConnectionRelation[] => {
    if (!isConnectionMode || connectionMemberIds.length < 2) return [];

    const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
    const result: ConnectionRelation[] = [];

    for (let i = 0; i < connectionMemberIds.length; i++) {
      for (let j = 0; j < connectionMemberIds.length; j++) {
        if (i === j) continue;
        const fromId = connectionMemberIds[i];
        const toId = connectionMemberIds[j];

        // Only emit for connected pairs (both ids must be highlighted).
        if (
          !connectionPath.nodeIds.has(fromId) ||
          !connectionPath.nodeIds.has(toId)
        )
          continue;

        const fromMember = memberMap.get(fromId);
        const toMember = memberMap.get(toId);
        if (!fromMember || !toMember) continue;

        const relation = classifyKinship(members, fromId, toId);
        if (relation.kind === "none" || relation.kind === "self") continue;

        const label = formatKinship(relation, fromMember.gender, tKinship);
        if (!label) continue;

        result.push({
          fromId,
          toId,
          fromName: fromMember.firstName || fromMember.lastName,
          toName: toMember.firstName || toMember.lastName,
          label,
        });
      }
    }

    return result;
  }, [
    isConnectionMode,
    connectionMemberIds,
    members,
    connectionPath.nodeIds,
    tKinship,
  ]);

  return {
    isConnectionMode,
    connectionMemberIds,
    connectionSelectedIds,
    connectionPath,
    hasConnectionPath,
    connectionRelations,
    toggleConnectionMode,
    handleNodeClick,
  };
};
