/// <reference lib="webworker" />

import { mapMembersFromRows } from "@/utils/memberMapping";
import { getLayoutedElements } from "@/utils/layoutUtils";
import type { Member } from "@/types/member";
import {
  applyRelationStyleOverride,
  getDefaultRelationEdgeStyle,
} from "@/utils/relationStyleUtils";
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerUnionInfo,
  WorkerEdge,
  RelationStyleMap,
} from "@/workers/treeProcessor.types";

// ---------------------------------------------------------------------------
// Helpers (mirrors main-thread logic — pure, no React/DOM imports)
// ---------------------------------------------------------------------------

const memberPairKey = (a: string, b: string): string =>
  a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

const COUPLE_RELATIONS = new Set(["married", "partner", "divorced"]);

const unionKey = (a: string, b: string) => `union-${[a, b].sort().join("-")}`;

function buildUnions(members: Member[]): WorkerUnionInfo[] {
  const memberIds = new Set(members.map((m) => m.id));
  const unions = new Map<string, WorkerUnionInfo>();

  const getOrCreate = (
    p1: string,
    p2: string,
    relType?: string,
  ): WorkerUnionInfo => {
    const id = unionKey(p1, p2);
    if (!unions.has(id)) {
      unions.set(id, {
        id,
        partner1Id: p1,
        partner2Id: p2,
        childIds: [],
        relationType: relType,
      });
    }
    const u = unions.get(id)!;
    if (!u.relationType && relType) u.relationType = relType;
    return u;
  };

  for (const child of members) {
    const { paternalParent, maternalParent } = child.parents;
    if (
      paternalParent &&
      maternalParent &&
      memberIds.has(paternalParent) &&
      memberIds.has(maternalParent)
    ) {
      const u = getOrCreate(paternalParent, maternalParent);
      u.childIds.push(child.id);
    }
  }

  const seen = new Set<string>();
  for (const member of members) {
    if (!member.relations) continue;
    for (const rel of member.relations) {
      if (!COUPLE_RELATIONS.has(rel.relationType)) continue;
      if (!memberIds.has(rel.toMemberId)) continue;
      const key = unionKey(member.id, rel.toMemberId);
      if (seen.has(key)) continue;
      seen.add(key);
      getOrCreate(member.id, rel.toMemberId, rel.relationType);
    }
  }

  return Array.from(unions.values());
}

export function buildEdges(
  members: Member[],
  unions: WorkerUnionInfo[],
  visibleRelationTypes: string[],
  edgeType: string,
  relationStyles: RelationStyleMap = {},
): WorkerEdge[] {
  const edges: WorkerEdge[] = [];
  const visibleTypesSet = new Set(visibleRelationTypes);
  const memberIds = new Set(members.map((m) => m.id));
  const edgeIds = new Set<string>();

  const childCoveredByUnion = new Set<string>();
  for (const u of unions) {
    for (const cId of u.childIds) childCoveredByUnion.add(cId);
  }

  const memberPositionX = new Map(members.map((m) => [m.id, m.position.x]));

  for (const u of unions) {
    if (!memberIds.has(u.partner1Id) || !memberIds.has(u.partner2Id)) continue;

    const relType = u.relationType ?? "";
    // Style of the couple line feeding this union dot. Children hang off the
    // dot, so their connectors inherit this exact style (the line they
    // originate from) rather than the generic "parent" style.
    const baseStyle = applyRelationStyleOverride(
      getDefaultRelationEdgeStyle(relType),
      relationStyles[relType],
    );

    const coupleVisible =
      visibleTypesSet.has("parent") ||
      (relType !== "" && visibleTypesSet.has(relType));

    if (coupleVisible) {
      const p1X = memberPositionX.get(u.partner1Id) ?? 0;
      const p2X = memberPositionX.get(u.partner2Id) ?? 0;
      const leftId = p1X <= p2X ? u.partner1Id : u.partner2Id;
      const rightId = p1X <= p2X ? u.partner2Id : u.partner1Id;
      const partnerKey = memberPairKey(u.partner1Id, u.partner2Id);
      const leftHighlightPairs = [
        partnerKey,
        ...u.childIds.map((cId) => memberPairKey(leftId, cId)),
      ];
      const rightHighlightPairs = [
        partnerKey,
        ...u.childIds.map((cId) => memberPairKey(rightId, cId)),
      ];

      edges.push({
        id: `ue:${u.id}:left`,
        source: leftId,
        target: u.id,
        sourceHandle: "right",
        targetHandle: "left",
        type: "smoothstep",
        baseStyle,
        _highlightPairs: leftHighlightPairs,
      });

      edges.push({
        id: `ue:${u.id}:right`,
        source: u.id,
        target: rightId,
        sourceHandle: "right",
        targetHandle: "left",
        type: "smoothstep",
        baseStyle,
        _highlightPairs: rightHighlightPairs,
      });
    }

    if (visibleTypesSet.has("parent")) {
      for (const cId of u.childIds) {
        const highlightPairs = [u.partner1Id, u.partner2Id].map((pId) =>
          memberPairKey(pId, cId),
        );
        edges.push({
          id: `ue:${u.id}:child:${cId}`,
          source: u.id,
          target: cId,
          sourceHandle: "bottom",
          targetHandle: "top",
          type: edgeType,
          baseStyle,
          _highlightPairs: highlightPairs,
        });
      }
    }
  }

  for (const m of members) {
    if (visibleTypesSet.has("parent") && !childCoveredByUnion.has(m.id)) {
      if (m.parents.maternalParent && memberIds.has(m.parents.maternalParent)) {
        edges.push({
          id: `e:${m.parents.maternalParent}:${m.id}`,
          source: m.parents.maternalParent,
          target: m.id,
          type: edgeType,
          sourceHandle: "bottom",
          targetHandle: "top",
          baseStyle: applyRelationStyleOverride(
            getDefaultRelationEdgeStyle("parent"),
            relationStyles["parent"],
          ),
          _highlightPairs: [memberPairKey(m.parents.maternalParent, m.id)],
        });
      }
      if (m.parents.paternalParent && memberIds.has(m.parents.paternalParent)) {
        edges.push({
          id: `e:${m.parents.paternalParent}:${m.id}`,
          source: m.parents.paternalParent,
          target: m.id,
          type: edgeType,
          sourceHandle: "bottom",
          targetHandle: "top",
          baseStyle: applyRelationStyleOverride(
            getDefaultRelationEdgeStyle("parent"),
            relationStyles["parent"],
          ),
          _highlightPairs: [memberPairKey(m.parents.paternalParent, m.id)],
        });
      }
    }

    if (!m.relations) continue;
    for (const rel of m.relations) {
      if (rel.relationType === "parent") continue;
      if (COUPLE_RELATIONS.has(rel.relationType)) continue;
      if (!visibleTypesSet.has(rel.relationType)) continue;
      if (!memberIds.has(rel.toMemberId)) continue;

      const pairKey = [m.id, rel.toMemberId].sort().join("-");
      const edgeId = `rel:${pairKey}:${rel.relationType}`;
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);

      edges.push({
        id: edgeId,
        source: m.id,
        target: rel.toMemberId,
        sourceHandle: "right",
        targetHandle: "left",
        type: "relation",
        baseStyle: applyRelationStyleOverride(
          getDefaultRelationEdgeStyle(rel.relationType),
          relationStyles[rel.relationType],
        ),
        _highlightPairs: [memberPairKey(m.id, rel.toMemberId)],
      });
    }
  }

  return edges;
}

function computeHiddenNodeIds(members: Member[]): string[] {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const visibilityCache = new Map<string, boolean>();
  const visiting = new Set<string>();

  const isVisible = (id: string): boolean => {
    if (visibilityCache.has(id)) return visibilityCache.get(id)!;
    if (visiting.has(id)) return true; // cycle guard

    visiting.add(id);
    const member = memberMap.get(id);
    if (!member) {
      visiting.delete(id);
      return false;
    }

    const parentIds = [
      member.parents.maternalParent,
      member.parents.paternalParent,
    ].filter(Boolean) as string[];

    if (parentIds.length === 0) {
      visibilityCache.set(id, true);
      visiting.delete(id);
      return true;
    }

    const visible = parentIds.every((parentId) => {
      const parent = memberMap.get(parentId);
      if (!parent) return true;
      return !parent.isCollapsed && isVisible(parentId);
    });

    visibilityCache.set(id, visible);
    visiting.delete(id);
    return visible;
  };

  return members.filter((m) => !isVisible(m.id)).map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

// Cache most-recently parsed members per treeId so derive tasks can reuse
// the result without re-transferring the full array when nothing has changed.
const parsedMembersCache = new Map<string, Member[]>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.kind === "parse") {
      const members = mapMembersFromRows(req.members, req.relations);
      parsedMembersCache.set(req.treeId, members);

      const response: WorkerResponse = {
        kind: "parse:done",
        reqId: req.reqId,
        treeId: req.treeId,
        members,
      };
      self.postMessage(response);
    } else if (req.kind === "derive") {
      // Always use the sent members (they reflect the latest store state, including
      // optimistic mutations like collapse/expand). Also update the cache so a future
      // derive that explicitly sends members doesn't cost an extra transfer.
      parsedMembersCache.set(req.treeId, req.members);
      const members = req.members;

      const unions = buildUnions(members);
      const edges = buildEdges(
        members,
        unions,
        req.visibleRelationTypes,
        req.edgeType,
        req.relationStyles,
      );
      const hiddenNodeIds = computeHiddenNodeIds(members);

      const response: WorkerResponse = {
        kind: "derive:done",
        reqId: req.reqId,
        treeId: req.treeId,
        unions,
        edges,
        hiddenNodeIds,
      };
      self.postMessage(response);
    } else if (req.kind === "layout") {
      const positions = getLayoutedElements(req.members);

      const response: WorkerResponse = {
        kind: "layout:done",
        reqId: req.reqId,
        treeId: req.treeId,
        positions,
      };
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      kind: "error",
      reqId: req.reqId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
