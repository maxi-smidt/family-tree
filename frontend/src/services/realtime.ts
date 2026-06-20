/**
 * Real-time tree-change notifications via Server-Sent Events.
 *
 * The JWT is sent as a query-parameter because EventSource cannot
 * include an Authorization header.  Reconnection uses exponential
 * backoff capped at 30 s.
 */

import { getAuthToken } from "@/services/api";
import { useMemberStore } from "@/hooks/useMemberStore";
import { isActiveTree, useTreeStore } from "@/hooks/useTreeStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

let source: EventSource | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

/** Open the SSE connection (idempotent if already open). */
export function startRealtime(): void {
  stopped = false;
  if (source !== null) return;
  connect();
}

function connect(): void {
  const token = getAuthToken();
  if (!token) return;

  const url = `${API_BASE}/sse/events?token=${encodeURIComponent(token)}`;
  source = new EventSource(url);

  source.onopen = () => {
    reconnectAttempts = 0;
  };

  const reload = () => {
    void useTreeStore.getState().loadTrees();
  };

  source.addEventListener("tree.ownership_changed", reload);
  source.addEventListener("tree.access_changed", reload);
  source.addEventListener("tree.deleted", reload);

  source.addEventListener("tree.layout_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { tree_id: string };
    if (!isActiveTree(data.tree_id)) return;
    void useMemberStore.getState().refreshMembers(data.tree_id);
  });

  source.onerror = () => {
    source?.close();
    source = null;
    if (stopped) return;
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(connect, delay);
}

/** Close the SSE connection and cancel any pending reconnect. */
export function stopRealtime(): void {
  stopped = true;
  clearTimeout(reconnectTimer);
  source?.close();
  source = null;
  reconnectAttempts = 0;
}
