/** A tiny, made-up family used to *illustrate* what a saved view or a new
 *  section would contain — never real workspace data. The walks below mirror
 *  the backend algorithms closely enough that the shaded nodes tell the truth
 *  about which kinds of relatives a setting pulls in:
 *
 *  - whole-workspace view: `_lineage_sequence` in
 *    `backend/app/services/workspaces/neighborhood.py` (straight ancestor and
 *    descendant lines, then one hop of partners);
 *  - section-filtered view: `_family_sequence` (hop by hop over every edge
 *    inside the section, within the generation band);
 *  - section creation: `subtree_selection.py`'s "direct family" and
 *    "partnership" selections. */

export type PreviewNodeKind = "person" | "more";

export interface PreviewNode {
  id: string;
  /** Horizontal slot, in layout units. */
  x: number;
  /** Generation relative to the focus — positive is older. */
  generation: number;
  kind: PreviewNodeKind;
}

export interface PreviewCouple {
  a: string;
  b: string;
}

export interface PreviewChildLink {
  child: string;
  /** One or two parents; two means the line drops from the couple's bar. */
  parents: [string] | [string, string];
}

export const PREVIEW_FOCUS_ID = "focus";

// Grandparents (+2), parents/uncle/in-laws (+1), focus row (0), children
// (-1) and a grandchild (-2). The "more" nodes stand for every generation
// past the drawn ones, so "all the way" has something to light up.
export const PREVIEW_NODES: PreviewNode[] = [
  { id: "more-up", x: 2.75, generation: 3, kind: "more" },
  { id: "gp1", x: 1.25, generation: 2, kind: "person" },
  { id: "gp2", x: 2.25, generation: 2, kind: "person" },
  { id: "gp3", x: 3.25, generation: 2, kind: "person" },
  { id: "gp4", x: 4.25, generation: 2, kind: "person" },
  { id: "uncle", x: 1, generation: 1, kind: "person" },
  { id: "father", x: 2.5, generation: 1, kind: "person" },
  { id: "mother", x: 3.5, generation: 1, kind: "person" },
  { id: "in-law1", x: 4.75, generation: 1, kind: "person" },
  { id: "in-law2", x: 5.75, generation: 1, kind: "person" },
  { id: "cousin", x: 1, generation: 0, kind: "person" },
  { id: "sibling", x: 2, generation: 0, kind: "person" },
  { id: PREVIEW_FOCUS_ID, x: 3, generation: 0, kind: "person" },
  { id: "partner", x: 5.25, generation: 0, kind: "person" },
  { id: "child-partner", x: 2.5, generation: -1, kind: "person" },
  { id: "child1", x: 3.5, generation: -1, kind: "person" },
  { id: "child2", x: 4.75, generation: -1, kind: "person" },
  { id: "grandchild", x: 3, generation: -2, kind: "person" },
  { id: "more-down", x: 3, generation: -3, kind: "more" },
];

export const PREVIEW_COUPLES: PreviewCouple[] = [
  { a: "gp1", b: "gp2" },
  { a: "gp3", b: "gp4" },
  { a: "father", b: "mother" },
  { a: "in-law1", b: "in-law2" },
  { a: PREVIEW_FOCUS_ID, b: "partner" },
  { a: "child-partner", b: "child1" },
];

export const PREVIEW_CHILD_LINKS: PreviewChildLink[] = [
  { child: "gp2", parents: ["more-up"] },
  { child: "gp3", parents: ["more-up"] },
  { child: "uncle", parents: ["gp1", "gp2"] },
  { child: "father", parents: ["gp1", "gp2"] },
  { child: "mother", parents: ["gp3", "gp4"] },
  { child: "cousin", parents: ["uncle"] },
  { child: "sibling", parents: ["father", "mother"] },
  { child: PREVIEW_FOCUS_ID, parents: ["father", "mother"] },
  { child: "partner", parents: ["in-law1", "in-law2"] },
  { child: "child1", parents: [PREVIEW_FOCUS_ID, "partner"] },
  { child: "child2", parents: [PREVIEW_FOCUS_ID, "partner"] },
  { child: "grandchild", parents: ["child-partner", "child1"] },
  { child: "more-down", parents: ["grandchild"] },
];

/** The dummy "chosen sections": the focus's own family, without the
 *  partner's parents — so a section-scoped preview visibly leaves a branch
 *  out. */
export const PREVIEW_SECTION_IDS: ReadonlySet<string> = new Set(
  PREVIEW_NODES.map((n) => n.id).filter(
    (id) => id !== "in-law1" && id !== "in-law2",
  ),
);

const parentsOf = new Map<string, string[]>();
const childrenOf = new Map<string, string[]>();
for (const { child, parents } of PREVIEW_CHILD_LINKS) {
  parentsOf.set(child, [...parents]);
  for (const parent of parents)
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
}
const partnersOf = new Map<string, string[]>();
for (const { a, b } of PREVIEW_COUPLES) {
  partnersOf.set(a, [...(partnersOf.get(a) ?? []), b]);
  partnersOf.set(b, [...(partnersOf.get(b) ?? []), a]);
}

const neighbours = (map: Map<string, string[]>, id: string) =>
  map.get(id) ?? [];

export interface ViewPreviewSettings {
  /** Generations up/down; `Infinity` means all the way. */
  up: number;
  down: number;
  includePartners: boolean;
  /** Whether the view is limited to chosen sections (the dummy section). */
  sectionScoped: boolean;
}

/** Which dummy nodes a saved view with these settings would show. */
export function previewViewMembers(settings: ViewPreviewSettings): Set<string> {
  return settings.sectionScoped ? familyWalk(settings) : lineageWalk(settings);
}

function lineageWalk({
  up,
  down,
  includePartners,
}: ViewPreviewSettings): Set<string> {
  const included = new Set([PREVIEW_FOCUS_ID]);
  for (const [map, depth] of [
    [childrenOf, down],
    [parentsOf, up],
  ] as const) {
    let frontier = [PREVIEW_FOCUS_ID];
    for (let level = 0; level < depth && frontier.length; level++) {
      frontier = frontier
        .flatMap((id) => neighbours(map, id))
        .filter((id) => !included.has(id));
      frontier.forEach((id) => included.add(id));
    }
  }
  if (includePartners)
    for (const id of [...included])
      neighbours(partnersOf, id).forEach((p) => included.add(p));
  return included;
}

function familyWalk({
  up,
  down,
  includePartners,
}: ViewPreviewSettings): Set<string> {
  const generation = new Map([[PREVIEW_FOCUS_ID, 0]]);
  let frontier = [PREVIEW_FOCUS_ID];
  while (frontier.length) {
    const next: string[] = [];
    for (const source of frontier) {
      const base = generation.get(source) ?? 0;
      const steps: [string, number][] = [
        ...neighbours(parentsOf, source).map((id): [string, number] => [
          id,
          base + 1,
        ]),
        ...neighbours(childrenOf, source).map((id): [string, number] => [
          id,
          base - 1,
        ]),
        ...(includePartners
          ? neighbours(partnersOf, source).map((id): [string, number] => [
              id,
              base,
            ])
          : []),
      ];
      for (const [target, gen] of steps) {
        if (generation.has(target) || !PREVIEW_SECTION_IDS.has(target))
          continue;
        if (gen > up || gen < -down) continue;
        generation.set(target, gen);
        next.push(target);
      }
    }
    frontier = next;
  }
  return new Set(generation.keys());
}

export type SectionPreviewDirection = "direct_family" | "partnership";

/** Which dummy nodes a section seeded from the focus would contain (the seed
 *  itself included, as the backend does). */
export function previewSectionMembers(
  direction: SectionPreviewDirection,
): Set<string> {
  const moved = new Set<string>();
  const queue: string[] = [];
  const visit = (id: string) => {
    if (id === PREVIEW_FOCUS_ID || moved.has(id)) return;
    moved.add(id);
    queue.push(id);
  };
  const vertical = (id: string) => [
    ...neighbours(parentsOf, id),
    ...neighbours(childrenOf, id),
  ];

  if (direction === "direct_family") {
    neighbours(parentsOf, PREVIEW_FOCUS_ID).forEach(visit);
    while (queue.length) vertical(queue.shift()!).forEach(visit);
    // One-hop partner pull, never the seed's own partners.
    for (const id of [...moved])
      neighbours(partnersOf, id).forEach((p) => {
        if (p !== PREVIEW_FOCUS_ID) moved.add(p);
      });
  } else {
    [
      ...neighbours(partnersOf, PREVIEW_FOCUS_ID),
      ...neighbours(childrenOf, PREVIEW_FOCUS_ID),
    ].forEach(visit);
    while (queue.length) {
      const id = queue.shift()!;
      [...vertical(id), ...neighbours(partnersOf, id)].forEach(visit);
    }
  }
  moved.add(PREVIEW_FOCUS_ID);
  return moved;
}
