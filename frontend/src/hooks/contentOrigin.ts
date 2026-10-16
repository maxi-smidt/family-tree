import { useMemberStore } from "@/hooks/useMemberStore";
import { isActiveTree } from "@/hooks/useWorkspaceStore";
import i18n from "@/i18n/i18n";

/** Capture creation scope before asynchronous work, such as staging uploads.
 * A view spanning several sections cannot silently pick or widen an audience. */
export function contentOriginArgs(workspaceId: string): [] | [string] {
  if (!isActiveTree(workspaceId)) return [];
  const sections = useMemberStore.getState().focusSectionIds;
  if (sections && sections.length > 1) {
    throw new Error(i18n.t("hooks.content-origin.choose-section"));
  }
  return sections?.length === 1 ? [sections[0]] : [];
}
