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

const HEARTBEAT_INTERVAL_MS = 30_000;

let currentTreeId: string | null = null;
let editingMemberId: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

async function sendHeartbeat(): Promise<void> {
  const treeId = currentTreeId;
  if (!treeId || inFlight) return;
  inFlight = true;
  try {
    const roster = await TreeService.sendPresence(treeId, editingMemberId);
    // A tree switch may have landed while the request was in flight.
    if (treeId === currentTreeId) {
      usePresenceStore.getState().setRoster(roster.tree_id, roster.users);
    }
  } catch (err) {
    // Feature turned off at runtime answers 404 — stop pinging this tree.
    if (
      err instanceof ApiError &&
      err.status === 404 &&
      treeId === currentTreeId
    ) {
      stopPresence();
    }
    // Transient errors (network blips, token refresh) resolve on the next tick.
  } finally {
    inFlight = false;
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
