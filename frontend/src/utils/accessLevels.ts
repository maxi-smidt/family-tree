import {
  AccessLevel,
  AccessLevels,
  SHARE_AREAS,
  ShareArea,
  Workspace,
  WorkspaceAccess,
} from "@/types/workspace";

export type AccessPreset = "tree-only" | "viewer" | "contributor" | "editor";

function levels(
  fallback: AccessLevel,
  overrides: Partial<AccessLevels>,
): AccessLevels {
  const result = {} as AccessLevels;
  for (const area of SHARE_AREAS) result[area] = overrides[area] ?? fallback;
  return result;
}

/** The share presets agreed in #1101. Health is hidden in every one. */
export const ACCESS_PRESETS: Record<AccessPreset, AccessLevels> = {
  "tree-only": levels("hidden", { tree: "view" }),
  viewer: levels("view", { diseases: "hidden", tasks: "hidden" }),
  contributor: levels("view", {
    tree: "edit",
    stories: "edit",
    diseases: "hidden",
  }),
  editor: levels("edit", { diseases: "hidden" }),
};

export const PRESET_ORDER: AccessPreset[] = [
  "tree-only",
  "viewer",
  "contributor",
  "editor",
];

/** A grant's level per area, from its role, hidden and read-only areas. */
export function levelsOf(
  access: Pick<WorkspaceAccess, "role" | "restrictions" | "read_only">,
): AccessLevels {
  const result = {} as AccessLevels;
  for (const area of SHARE_AREAS) {
    if (access.restrictions?.includes(area)) result[area] = "hidden";
    else if (access.role !== "editor" || access.read_only?.includes(area))
      result[area] = "view";
    else result[area] = "edit";
  }
  return result;
}

/** The preset these levels match exactly, or null for a custom mix. */
export function presetOf(value: AccessLevels): AccessPreset | null {
  return (
    PRESET_ORDER.find((preset) =>
      SHARE_AREAS.every((area) => ACCESS_PRESETS[preset][area] === value[area]),
    ) ?? null
  );
}

/** Whether the current user may change content in ``area`` of this
 *  workspace. Owners (and admins, who are reported as owners) always may;
 *  with no workspace or role loaded yet this stays permissive, as the old
 *  ``role !== "viewer"`` checks were. The backend enforces the real rule. */
export function canEditArea(
  tree: Workspace | null | undefined,
  area: ShareArea,
): boolean {
  if (!tree || tree.role === undefined || tree.role === "owner") return true;
  if (tree.role !== "editor") return false;
  return (
    !(tree.restrictions ?? []).includes(area) &&
    !(tree.read_only ?? []).includes(area)
  );
}
