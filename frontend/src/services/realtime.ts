/**
 * Real-time tree-change notifications via Server-Sent Events.
 *
 * The JWT is sent as a query-parameter because EventSource cannot
 * include an Authorization header.  Reconnection uses exponential
 * backoff capped at 30 s.
 */

import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import { getAuthToken } from "@/services/api";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useJobStore } from "@/hooks/useJobStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSourceStore } from "@/hooks/useSourceStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { useStoryStore } from "@/hooks/useStoryStore";
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

  source.addEventListener("backup.completed", () => {
    useAdminViewStore.getState().bumpBackupTick();
  });

  source.addEventListener("purge.ran", () => {
    useAdminViewStore.getState().bumpPurgeTick();
  });

  source.addEventListener("session.invalidate", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { reason: string };
    const key =
      data.reason === "pending_deletion"
        ? "auth.session.invalidated-pending-deletion"
        : "auth.session.invalidated-deactivated";
    stopRealtime();
    useAuthStore.getState().logout();
    toast.error(i18n.t(key));
  });

  source.addEventListener("activity.entry_added", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { tree_id: string };
    if (!isActiveTree(data.tree_id)) return;
    void useActivityStore.getState().refreshActivity(data.tree_id);
  });

  const domainRefreshers: Record<string, (treeId: string) => void> = {
    member: (id) => void useMemberStore.getState().refreshMembers(id),
    event: (id) => void useEventStore.getState().refreshEvents(id),
    story: (id) => void useStoryStore.getState().refreshStories(id),
    source: (id) => void useSourceStore.getState().refreshSources(id),
    gallery: (id) => void useGalleryStore.getState().refreshGalleryImages(id),
  };
  source.addEventListener("tree.content_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      domain: string;
    };
    if (!isActiveTree(data.tree_id)) return;
    domainRefreshers[data.domain]?.(data.tree_id);
  });

  source.addEventListener("friend.request_received", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      requester_id: string;
      requester_username: string;
    };
    void useFriendStore.getState().loadIncoming();
    toast.info(
      i18n.t("auth.friends.new-request", { name: data.requester_username }),
    );
  });

  source.addEventListener("invitation.received", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      tree_name: string;
    };
    void useTreeStore.getState().loadTrees();
    toast.info(
      i18n.t("dialog.share-tree.invitation-received", { name: data.tree_name }),
    );
  });

  source.addEventListener("tree.layout_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { tree_id: string };
    if (!isActiveTree(data.tree_id)) return;
    void useMemberStore.getState().refreshMembers(data.tree_id);
  });

  source.addEventListener("job.progress", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      pct: number;
    };
    useJobStore.getState().onProgress(data.job_id, data.pct);
  });

  source.addEventListener("job.done", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      tree_id: string;
    };
    useJobStore.getState().onDone(data.job_id, data.tree_id);
  });

  source.addEventListener("job.failed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      error: string;
    };
    useJobStore.getState().onFailed(data.job_id, data.error);
  });

  source.addEventListener("storage.warning", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      used_bytes: number;
      quota_bytes: number;
    };
    if (!isActiveTree(data.tree_id)) return;
    void useStorageStore.getState().refreshStorageUsage(data.tree_id);
    toast.warning(i18n.t("storage-usage.quota-warning"));
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
