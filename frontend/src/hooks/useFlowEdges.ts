import { useMemo } from "react";
import { Edge } from "@xyflow/react";
import { Member, RelationType } from "@/types/member";

export const useFlowEdges = (
  members: Member[],
  visibleRelationTypes: RelationType[],
  edgeType: string,
) => {
  return useMemo(() => {
    const newEdges: Edge[] = [];
    const processedPairs = new Set<string>();
    const visibleTypesSet = new Set(visibleRelationTypes);

    const createEdgeId = (source: string, target: string) =>
      `e:${source}:${target}`;

    members.forEach((m) => {
      if (visibleTypesSet.has("parent")) {
        if (m.parents.maternalParent) {
          newEdges.push({
            id: createEdgeId(m.parents.maternalParent, m.id),
            source: m.parents.maternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
        if (m.parents.paternalParent) {
          newEdges.push({
            id: createEdgeId(m.parents.paternalParent, m.id),
            source: m.parents.paternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
      }

      if (m.relations) {
        m.relations.forEach((rel) => {
          if (
            rel.relationType !== "parent" &&
            visibleTypesSet.has(rel.relationType)
          ) {
            const pairKey = [m.id, rel.toMemberId].sort().join("-");
            if (processedPairs.has(pairKey)) return;
            processedPairs.add(pairKey);

            let strokeColor = "var(--muted-foreground)";
            let strokeDasharray = "5,5";

            switch (rel.relationType) {
              case "married":
                strokeColor = "hsl(142 76% 36%)"; // green-600
                strokeDasharray = "0";
                break;
              case "divorced":
                strokeColor = "var(--destructive)";
                strokeDasharray = "5,5";
                break;
              case "partner":
                strokeColor = "hsl(217 91% 60%)"; // blue-500
                strokeDasharray = "5,5";
                break;
              case "sibling":
                strokeColor = "hsl(45 93% 47%)"; // yellow-500
                strokeDasharray = "0";
                break;
            }

            newEdges.push({
              id: `rel:${m.id}:${rel.toMemberId}:${rel.relationType}`,
              source: m.id,
              target: rel.toMemberId,
              sourceHandle: "right",
              targetHandle: "left",
              type: "relation",
              style: {
                stroke: strokeColor,
                strokeDasharray: strokeDasharray,
                strokeWidth: 2,
              },
              animated: false,
            });
          }
        });
      }
    });
    return newEdges;
  }, [members, visibleRelationTypes, edgeType]);
};
