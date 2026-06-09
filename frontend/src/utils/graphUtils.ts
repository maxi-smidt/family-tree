import { Member } from "@/types/member";

export interface MissingConnectionPair {
  fromId: string;
  toId: string;
}

export interface ConnectionPathHighlight {
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
  missingPairs: MissingConnectionPair[];
}

type MemberGraph = Map<string, Set<string>>;

export const memberPairKey = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

export function buildMemberConnectionGraph(members: Member[]): MemberGraph {
  const memberIds = new Set(members.map((member) => member.id));
  const graph: MemberGraph = new Map(
    members.map((member) => [member.id, new Set<string>()]),
  );

  const addEdge = (fromId: string | null, toId: string | null) => {
    if (!fromId || !toId || fromId === toId) return;
    if (!memberIds.has(fromId) || !memberIds.has(toId)) return;
    graph.get(fromId)?.add(toId);
    graph.get(toId)?.add(fromId);
  };

  for (const member of members) {
    addEdge(member.id, member.parents.paternalParent);
    addEdge(member.id, member.parents.maternalParent);

    for (const relation of member.relations ?? []) {
      addEdge(member.id, relation.toMemberId);
    }
  }

  return graph;
}

export function findShortestMemberPath(
  graph: MemberGraph,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId];
  if (!graph.has(fromId) || !graph.has(toId)) return null;

  const queue = [fromId];
  const previous = new Map<string, string | null>([[fromId, null]]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const neighbors = Array.from(graph.get(currentId) ?? []).sort();

    for (const neighborId of neighbors) {
      if (previous.has(neighborId)) continue;
      previous.set(neighborId, currentId);

      if (neighborId === toId) {
        const path = [toId];
        let step = currentId;
        while (step) {
          path.push(step);
          step = previous.get(step) ?? "";
        }
        return path.reverse();
      }

      queue.push(neighborId);
    }
  }

  return null;
}

export function findConnectionPathHighlight(
  members: Member[],
  selectedMemberIds: string[],
): ConnectionPathHighlight {
  const graph = buildMemberConnectionGraph(members);
  const validSelectedIds = selectedMemberIds.filter(
    (id, index) => graph.has(id) && selectedMemberIds.indexOf(id) === index,
  );
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const missingPairs: MissingConnectionPair[] = [];

  if (validSelectedIds.length < 2) {
    return { nodeIds, edgeKeys, missingPairs };
  }

  for (let i = 0; i < validSelectedIds.length; i += 1) {
    for (let j = i + 1; j < validSelectedIds.length; j += 1) {
      const fromId = validSelectedIds[i];
      const toId = validSelectedIds[j];
      const path = findShortestMemberPath(graph, fromId, toId);

      if (!path) {
        missingPairs.push({ fromId, toId });
        continue;
      }

      path.forEach((id) => nodeIds.add(id));
      for (let k = 0; k < path.length - 1; k += 1) {
        edgeKeys.add(memberPairKey(path[k], path[k + 1]));
      }
    }
  }

  return { nodeIds, edgeKeys, missingPairs };
}
