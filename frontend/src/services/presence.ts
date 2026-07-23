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
import { TreeService } from "@/services/TreeService";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { useTreeStore } from "@/hooks/useTreeStore";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

let currentTreeId: string | null = null;
let editingMemberId: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const inFlightTreeIds = new Set<string>();
const pendingTreeIds = new Set<string>();
const requestControllers = new Map<string, AbortController>();

async function sendHeartbeat(): Promise<void> {
  const treeId = currentTreeId;
  if (!treeId) return;
  if (inFlightTreeIds.has(treeId)) {
    // Preserve the most recent edit target or tree selection rather than
    // silently waiting for the next 30-second interval.
    pendingTreeIds.add(treeId);
    return;
  }

  inFlightTreeIds.add(treeId);
  pendingTreeIds.delete(treeId);
  const controller = new AbortController();
  requestControllers.set(treeId, controller);
  const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

  try {
    const roster = await TreeService.sendPresence(
      treeId,
      editingMemberId,
      controller.signal,
    );
    // A tree switch may have landed while the request was in flight.
    if (treeId === currentTreeId) {
      usePresenceStore.getState().setRoster(roster.tree_id, roster.users);
    }
  } catch (err) {
    // 404: the feature was turned off at runtime. 403: access to the tree
    // was revoked mid-session. Both end this tree's presence session — stop
    // heartbeating and clear the roster so stale presence chips disappear
    // (#814).
    if (
      err instanceof ApiError &&
      (err.status === 404 || err.status === 403) &&
      treeId === currentTreeId
    ) {
      stopPresence();
      if (err.status === 403) {
        // Backstop in case the tree.access_changed SSE event was missed:
        // make the tree store notice the lost access right away.
        void useTreeStore
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
    inFlightTreeIds.delete(treeId);
    if (requestControllers.get(treeId) === controller) {
      requestControllers.delete(treeId);
    }
    if (treeId === currentTreeId && pendingTreeIds.delete(treeId)) {
      void sendHeartbeat();
    }
  }
}

/** Begin heartbeating for `treeId` (idempotent for the same tree). */
export function startPresence(treeId: string): void {
  if (currentTreeId === treeId) return;
  stopPresence();
  currentTreeId = treeId;
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
  const treeId = currentTreeId;
  currentTreeId = null;
  editingMemberId = null;
  pendingTreeIds.clear();
  if (treeId) requestControllers.get(treeId)?.abort();
  usePresenceStore.getState().clear();
  if (treeId) {
    void TreeService.leavePresence(treeId).catch(() => {
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
