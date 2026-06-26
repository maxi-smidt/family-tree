import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeMouseHandler } from "@xyflow/react";
import { Member } from "@/types/member";
import {
  classifyRelationship,
  findConnectionPathHighlight,
  pruneConnectionMemberIds,
} from "@/utils/graphUtils";
import { formatKinship } from "@/utils/kinship";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * A connected pair of selected members with the kinship noun in BOTH
 * directions, so the UI can render two opposing arrows:
 *   a ──aToBLabel──▶ b   (a is the <aToBLabel> of b)
 *   a ◀──bToALabel── b   (b is the <bToALabel> of a)
 */
export interface ConnectionRelation {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** Localised noun for "a is the <…> of b", e.g. "grandmother". */
  aToBLabel: string | null;
  /** Localised noun for "b is the <…> of a", e.g. "grandson". */
  bToALabel: string | null;
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
   * Derived kinship labels — one entry per unordered pair of selected members
   * that are connected (both appear in connectionPath.nodeIds) and yield a
   * translatable kinship noun in at least one direction.
   *
   * Each entry carries both directions (aToBLabel / bToALabel) so the UI can
   * draw two opposing, individually-labelled arrows between the two names.
   */
  const connectionRelations = useMemo((): ConnectionRelation[] => {
    if (!isConnectionMode || connectionMemberIds.length < 2) return [];

    const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
    const result: ConnectionRelation[] = [];

    // One entry per unordered connected pair, carrying both directions so the
    // UI can draw two opposing, individually-labelled arrows.
    for (let i = 0; i < connectionMemberIds.length; i++) {
      for (let j = i + 1; j < connectionMemberIds.length; j++) {
        const aId = connectionMemberIds[i];
        const bId = connectionMemberIds[j];

        // Only emit for connected pairs (both ids must be highlighted).
        if (
          !connectionPath.nodeIds.has(aId) ||
          !connectionPath.nodeIds.has(bId)
        )
          continue;

        const aMember = memberMap.get(aId);
        const bMember = memberMap.get(bId);
        if (!aMember || !bMember) continue;

        const aToB = classifyRelationship(members, aId, bId);
        const bToA = classifyRelationship(members, bId, aId);
        const aToBLabel = formatKinship(aToB, aMember.gender, tKinship);
        const bToALabel = formatKinship(bToA, bMember.gender, tKinship);

        // Nothing to show if neither direction yields a term.
        if (!aToBLabel && !bToALabel) continue;

        result.push({
          aId,
          bId,
          aName: aMember.firstName || aMember.lastName,
          bName: bMember.firstName || bMember.lastName,
          aToBLabel,
          bToALabel,
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
