import { useMemo } from "react";
import { Edge } from "@xyflow/react";
import { Member, RelationType } from "@/types/member";
import { UnionInfo } from "@/hooks/useFlowUnions";

const COUPLE_RELATIONS = new Set(["married", "partner", "divorced"]);

const coupleStyle = (relationType: string) => {
  switch (relationType) {
    case "married":
      return { stroke: "hsl(142 76% 36%)", strokeDasharray: "0" };
    case "divorced":
      return { stroke: "var(--destructive)", strokeDasharray: "5,5" };
    case "partner":
      return { stroke: "hsl(217 91% 60%)", strokeDasharray: "5,5" };
    default:
      return { stroke: "var(--muted-foreground)", strokeDasharray: "5,5" };
  }
};

export const useFlowEdges = (
  members: Member[],
  unions: UnionInfo[],
  visibleRelationTypes: RelationType[],
  edgeType: string,
) => {
  return useMemo(() => {
    const newEdges: Edge[] = [];
    const visibleTypesSet = new Set(visibleRelationTypes);
    const memberIds = new Set(members.map((m) => m.id));

    // Build a set of child IDs that are claimed by a union node so we can
    // skip the direct parent→child edges for those children.
    const childCoveredByUnion = new Set<string>();
    for (const u of unions) {
      for (const cId of u.childIds ?? []) {
        childCoveredByUnion.add(cId);
      }
    }

    // Build a position lookup from the members array for handle-side selection.
    const memberPositionX = new Map(members.map((m) => [m.id, m.position.x]));

    // --- Union connector edges ---
    for (const u of unions) {
      if (
        !memberIds.has(u.partner1Id as string) ||
        !memberIds.has(u.partner2Id as string)
      )
        continue;

      // Couple connector (partner1 → union → partner2): show whenever "parent"
      // is visible (the union groups the parents, so the connector is always
      // needed when parent edges are on), OR when the explicit couple type is
      // toggled on independently.
      const relType = (u.relationType as string) ?? "";
      const coupleVisible =
        visibleTypesSet.has("parent") ||
        (relType !== "" && visibleTypesSet.has(relType));

      if (coupleVisible) {
        const style = coupleStyle(relType);
        const baseStyle = { ...style, strokeWidth: 2 };

        // Determine which partner is visually to the left so we always route
        // innerHandle → union → innerHandle rather than wrapping around the outside.
        const p1X = memberPositionX.get(u.partner1Id as string) ?? 0;
        const p2X = memberPositionX.get(u.partner2Id as string) ?? 0;
        const leftId = p1X <= p2X ? u.partner1Id : u.partner2Id;
        const rightId = p1X <= p2X ? u.partner2Id : u.partner1Id;

        // left partner's RIGHT handle → union LEFT handle
        newEdges.push({
          id: `ue:${u.id}:left`,
          source: leftId as string,
          target: u.id as string,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          style: baseStyle,
          animated: false,
        });

        // union RIGHT handle → right partner's LEFT handle
        newEdges.push({
          id: `ue:${u.id}:right`,
          source: u.id as string,
          target: rightId as string,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          style: baseStyle,
          animated: false,
        });
      }

      // Union → child edges are shown when "parent" is visible.
      if (visibleTypesSet.has("parent")) {
        for (const cId of (u.childIds as string[]) ?? []) {
          newEdges.push({
            id: `ue:${u.id}:child:${cId}`,
            source: u.id as string,
            target: cId,
            sourceHandle: "bottom",
            targetHandle: "top",
            // smoothstep gives a vertical-first drop that reads like a classic
            // family-tree descent line.
            type: "smoothstep",
            style: { strokeWidth: 1.5 },
            animated: false,
          });
        }
      }
    }

    // --- Per-member edges ---
    for (const m of members) {
      // Single-parent → child edges (child not covered by a union node).
      if (visibleTypesSet.has("parent") && !childCoveredByUnion.has(m.id)) {
        if (
          m.parents.maternalParent &&
          memberIds.has(m.parents.maternalParent)
        ) {
          newEdges.push({
            id: `e:${m.parents.maternalParent}:${m.id}`,
            source: m.parents.maternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
        if (
          m.parents.paternalParent &&
          memberIds.has(m.parents.paternalParent)
        ) {
          newEdges.push({
            id: `e:${m.parents.paternalParent}:${m.id}`,
            source: m.parents.paternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
      }

      // Non-parent, non-couple relations (sibling, step-parent, etc.).
      if (!m.relations) continue;
      for (const rel of m.relations) {
        if (rel.relationType === "parent") continue;
        // Couple relations are now routed through union nodes.
        if (COUPLE_RELATIONS.has(rel.relationType)) continue;
        if (!visibleTypesSet.has(rel.relationType)) continue;
        if (!memberIds.has(rel.toMemberId)) continue;

        const pairKey = [m.id, rel.toMemberId].sort().join("-");
        // Deduplicate bidirectional edges.
        const edgeId = `rel:${pairKey}:${rel.relationType}`;
        if (newEdges.some((e) => e.id === edgeId)) continue;

        let strokeColor = "var(--muted-foreground)";
        let strokeDasharray = "5,5";
        if (rel.relationType === "sibling") {
          strokeColor = "hsl(45 93% 47%)";
          strokeDasharray = "0";
        }

        newEdges.push({
          id: edgeId,
          source: m.id,
          target: rel.toMemberId,
          sourceHandle: "right",
          targetHandle: "left",
          type: "relation",
          style: {
            stroke: strokeColor,
            strokeDasharray,
            strokeWidth: 2,
          },
          animated: false,
        });
      }
    }

    return newEdges;
  }, [members, unions, visibleRelationTypes, edgeType]);
};
