import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeMouseHandler } from "@xyflow/react";
import { Member } from "@/types/member";
import {
  buildMemberConnectionGraph,
  classifyRelationship,
  findConnectionPathHighlight,
  findShortestMemberPath,
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
  /**
   * True when the relationship is symmetric and gender-neutral (the "relative"
   * fallback): both labels are identical and the card renders a single
   * double-headed arrow instead of two opposing ones.
   */
  symmetric?: boolean;
}

/**
 * Minimum path-edge count for a connected-but-unlabeled pair to be classified
 * as "distant relative" rather than plain "relative".
 *
 * First cousins share a path of 4 edges (A→parent→grandparent→parent→B) and
 * already receive a named cousin label, so the fallback only fires for pairs
 * farther away. Setting the threshold to 5 ensures all cousin-level ties
 * (degree 1, no removal) are already named before the fallback is reached.
 */
const DISTANT_RELATIVE_MIN_EDGES = 5;

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
   * that are connected (both appear in connectionPath.nodeIds).
   *
   * Each entry carries the kinship noun in BOTH directions (aToBLabel /
   * bToALabel) so the card can draw two opposing, individually-labelled arrows.
   * When a connected pair has no precise relation in either direction, it falls
   * back to a single symmetric "relative" / "distant relative" label.
   */
  const connectionRelations = useMemo((): ConnectionRelation[] => {
    if (!isConnectionMode || connectionMemberIds.length < 2) return [];

    const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
    const result: ConnectionRelation[] = [];

    // Built lazily — only the "relative" fallback needs path lengths.
    let graph: ReturnType<typeof buildMemberConnectionGraph> | null = null;

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

        const aName = aMember.firstName || aMember.lastName;
        const bName = bMember.firstName || bMember.lastName;

        const aToBLabel = formatKinship(
          classifyRelationship(members, aId, bId),
          aMember.gender,
          tKinship,
        );
        const bToALabel = formatKinship(
          classifyRelationship(members, bId, aId),
          bMember.gender,
          tKinship,
        );

        if (aToBLabel || bToALabel) {
          result.push({ aId, bId, aName, bName, aToBLabel, bToALabel });
          continue;
        }

        // Fallback: connected but no precise term in either direction → a single
        // symmetric "relative" / "distant relative" label on a double arrow.
        graph ??= buildMemberConnectionGraph(members);
        const path = findShortestMemberPath(graph, aId, bId);
        if (!path) continue;

        const distant = path.length - 1 >= DISTANT_RELATIVE_MIN_EDGES;
        const label = formatKinship(
          { kind: "relative", distant },
          "o",
          tKinship,
        );
        if (!label) continue;

        result.push({
          aId,
          bId,
          aName,
          bName,
          aToBLabel: label,
          bToALabel: label,
          symmetric: true,
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
