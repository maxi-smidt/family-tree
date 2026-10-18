/**
 * Live-collaboration presence heartbeats.
 *
 * SSE is one-way, so a client announces itself by POSTing short heartbeats
 * (~30 s, plus immediately whenever its editing target changes). The server
 * replies with the full roster and also fans it out to everyone else as
 * `presence.updated`. A best-effort DELETE on leave keeps the roster tidy;
 * the server-side TTL is the backstop for a client that just vanishes.
 *
 * This module owns the timer and the "which tree / which member" state. React
 * drives it through `usePresence` — components never call it directly.
 */

import { ApiError } from "@/services/api";
import { WorkspaceService } from "@/services/WorkspaceService";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

let currentTreeId: string | null = null;
let editingMemberId: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const inFlightTreeIds = new Set<string>();
const pendingTreeIds = new Set<string>();
const requestControllers = new Map<string, AbortController>();

async function sendHeartbeat(): Promise<void> {
  const workspaceId = currentTreeId;
  if (!workspaceId) return;
  if (inFlightTreeIds.has(workspaceId)) {
    // Preserve the most recent edit target or tree selection rather than
    // silently waiting for the next 30-second interval.
    pendingTreeIds.add(workspaceId);
    return;
  }

  inFlightTreeIds.add(workspaceId);
  pendingTreeIds.delete(workspaceId);
  const controller = new AbortController();
  requestControllers.set(workspaceId, controller);
  const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

  try {
    const roster = await WorkspaceService.sendPresence(
      workspaceId,
      editingMemberId,
      controller.signal,
    );
    // A tree switch may have landed while the request was in flight.
    if (workspaceId === currentTreeId) {
      usePresenceStore.getState().setRoster(roster.workspace_id, roster.users);
    }
  } catch (err) {
    // 404: the feature was turned off at runtime. 403: access to the tree
    // was revoked mid-session. Both end this tree's presence session — stop
    // heartbeating and clear the roster so stale presence chips disappear
    // (#814).
    if (
      err instanceof ApiError &&
      (err.status === 404 || err.status === 403) &&
      workspaceId === currentTreeId
    ) {
      stopPresence();
      if (err.status === 403) {
        // Backstop in case the workspace.access_changed SSE event was missed:
        // make the tree store notice the lost access right away.
        void useWorkspaceStore
          .getState()
          .loadTrees()
          .catch(() => {
            // Transient failure — the next SSE event or heartbeat retries.
          });
      }
    }
    // Transient errors and aborted requests resolve on the next tick.
  } finally {
    clearTimeout(timeout);
    inFlightTreeIds.delete(workspaceId);
    if (requestControllers.get(workspaceId) === controller) {
      requestControllers.delete(workspaceId);
    }
    if (workspaceId === currentTreeId && pendingTreeIds.delete(workspaceId)) {
      void sendHeartbeat();
    }
  }
}

/** Begin heartbeating for `workspaceId` (idempotent for the same tree). */
export function startPresence(workspaceId: string): void {
  if (currentTreeId === workspaceId) return;
  stopPresence();
  currentTreeId = workspaceId;
  editingMemberId = null;
  void sendHeartbeat();
  timer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
}

/** Stop heartbeating and drop out of the current tree's roster. */
export function stopPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  const workspaceId = currentTreeId;
  currentTreeId = null;
  editingMemberId = null;
  pendingTreeIds.clear();
  if (workspaceId) requestControllers.get(workspaceId)?.abort();
  usePresenceStore.getState().clear();
  if (workspaceId) {
    void WorkspaceService.leavePresence(workspaceId).catch(() => {
      // Best effort: the TTL cleans up if this never reaches the server.
    });
  }
}

/** Update the member this client is editing (null = just viewing). */
export function setEditingMember(memberId: string | null): void {
  if (editingMemberId === memberId) return;
  editingMemberId = memberId;
  void sendHeartbeat();
}
