import { WorkspaceService } from "@/services/WorkspaceService";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { isVirtualId } from "@/hooks/useWorkspaceStore";
import { MemberSheetState } from "@/utils/memberSheetState";

const MIGRATION_FLAG_KEY = "ft_v1_state_migrated";

/** Rewrites/drops stale v1 entries in `openSheets`: a workspace id the
 *  conversion mapped is rewritten to its current id; an unmapped `vv_`
 *  (virtual view) entry is dropped outright, since virtual views don't carry
 *  a deterministic migration mapping the way workspaces do (#1012). Anything
 *  else — including a workspace id with no mapping, which is either already
 *  current or was never touched by the conversion — is left as-is. */
export function remapOpenSheets(
  openSheets: Record<string, MemberSheetState>,
  idMap: Map<string, string>,
): Record<string, MemberSheetState> {
  const next: Record<string, MemberSheetState> = {};
  for (const [id, state] of Object.entries(openSheets)) {
    if (isVirtualId(id)) continue;
    next[idMap.get(id) ?? id] = state;
  }
  return next;
}

/** One-time v1->v2 browser-state migration (#1012), run once per browser on
 *  the first authenticated boot. Resolves each open sheet's id individually
 *  through the unauthenticated legacy-id lookup rather than the current
 *  user's own migration reports — those are owned by whoever *owns* the
 *  converted workspace, so a sheet left open on a tree merely shared with
 *  this user would otherwise never be found. Best-effort and idempotent: a
 *  failure here leaves the local flag unset so the next login retries, and
 *  must never block login or tree loading either way. */
export async function migrateV1BrowserState(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;
  try {
    const { openSheets } = useMemberSheetStore.getState();
    const staleIds = Object.keys(openSheets).filter((id) => !isVirtualId(id));
    const idMap = new Map<string, string>();
    await Promise.all(
      staleIds.map(async (id) => {
        const targetId = await WorkspaceService.resolveLegacyWorkspaceId(
          id,
        ).catch(() => null);
        if (targetId) idMap.set(id, targetId);
      }),
    );
    useMemberSheetStore.setState({
      openSheets: remapOpenSheets(openSheets, idMap),
    });
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
  } catch (error) {
    console.error("v1 browser-state migration failed", error);
  }
}
