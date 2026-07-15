/**
 * Real-time tree-change notifications via Server-Sent Events.
 *
 * EventSource cannot include an Authorization header, so the access JWT is
 * exchanged for a one-purpose, short-lived SSE ticket. Reconnection uses
 * exponential backoff capped at 30 s.
 */

import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import { api } from "@/services/api";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useJobStore } from "@/hooks/useJobStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { isActiveTree, useTreeStore } from "@/hooks/useTreeStore";
import { PresenceUserDB } from "@/types/presence";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

let source: EventSource | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let connecting = false;
let generation = 0;

/** Open the SSE connection (idempotent if already open). */
export function startRealtime(): void {
  stopped = false;
  if (source !== null || connecting) return;
  void connect();
}

async function connect(): Promise<void> {
  if (stopped || source !== null || connecting) return;
  const attempt = generation;
  connecting = true;
  let ticket: string;
  try {
    ({ ticket } = await api.post<{ ticket: string }>("/sse/ticket"));
  } catch {
    if (!stopped && attempt === generation) scheduleReconnect();
    return;
  } finally {
    if (attempt === generation) connecting = false;
  }
  if (stopped || attempt !== generation) return;

  const url = `${API_BASE}/sse/events?ticket=${encodeURIComponent(ticket)}`;
  const eventSource = new EventSource(url);
  source = eventSource;

  eventSource.onopen = () => {
    reconnectAttempts = 0;
  };

  const reload = () => {
    void useTreeStore.getState().loadTrees();
  };

  eventSource.addEventListener("tree.ownership_changed", reload);
  eventSource.addEventListener("tree.access_changed", reload);
  eventSource.addEventListener("tree.deleted", reload);

  eventSource.addEventListener("backup.completed", () => {
    useAdminViewStore.getState().bumpBackupTick();
  });

  eventSource.addEventListener("purge.ran", () => {
    useAdminViewStore.getState().bumpPurgeTick();
  });

  eventSource.addEventListener("session.invalidate", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { reason: string };
    const key =
      data.reason === "pending_deletion"
        ? "auth.session.invalidated-pending-deletion"
        : "auth.session.invalidated-deactivated";
    stopRealtime();
    useAuthStore.getState().logout();
    toast.error(i18n.t(key));
  });

  eventSource.addEventListener("activity.entry_added", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { tree_id: string };
    if (!isActiveTree(data.tree_id)) return;
    void useActivityStore.getState().refreshActivity(data.tree_id);
  });

  const domainRefreshers: Record<string, (treeId: string) => void> = {
    member: (id) => void useMemberStore.getState().refreshMembers(id),
    event: (id) => void useEventStore.getState().refreshEvents(id),
    story: (id) => void useStoryStore.getState().refreshStories(id),
    document: (id) => void useDocumentStore.getState().refreshDocuments(id),
    gallery: (id) => void useGalleryStore.getState().refreshGalleryImages(id),
  };
  eventSource.addEventListener("tree.content_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      domain: string;
    };
    if (!isActiveTree(data.tree_id)) return;
    domainRefreshers[data.domain]?.(data.tree_id);
  });

  eventSource.addEventListener("friend.request_received", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      requester_id: string;
      requester_username: string;
    };
    void useFriendStore.getState().loadIncoming();
    toast.info(
      i18n.t("auth.friends.new-request", { name: data.requester_username }),
    );
  });

  eventSource.addEventListener("invitation.received", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      tree_name: string;
    };
    void useTreeStore.getState().loadTrees();
    toast.info(
      i18n.t("dialog.share-tree.invitation-received", { name: data.tree_name }),
    );
  });

  eventSource.addEventListener("presence.updated", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      users: PresenceUserDB[];
    };
    if (!isActiveTree(data.tree_id)) return;
    usePresenceStore.getState().setRoster(data.tree_id, data.users);
  });

  eventSource.addEventListener("tree.layout_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { tree_id: string };
    if (!isActiveTree(data.tree_id)) return;
    void useMemberStore.getState().refreshMembers(data.tree_id);
  });

  eventSource.addEventListener("job.progress", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      pct: number;
    };
    useJobStore.getState().onProgress(data.job_id, data.pct);
  });

  eventSource.addEventListener("job.done", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      tree_id: string;
    };
    useJobStore.getState().onDone(data.job_id, data.tree_id);
  });

  eventSource.addEventListener("job.failed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      job_id: string;
      error: string;
    };
    useJobStore.getState().onFailed(data.job_id, data.error);
  });

  eventSource.addEventListener("storage.warning", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      tree_id: string;
      used_bytes: number;
      quota_bytes: number;
    };
    if (!isActiveTree(data.tree_id)) return;
    void useStorageStore.getState().refreshStorageUsage(data.tree_id);
    toast.warning(i18n.t("storage-usage.quota-warning"));
  });

  eventSource.onerror = () => {
    eventSource.close();
    if (source !== eventSource) return;
    source = null;
    if (stopped) return;
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => void connect(), delay);
}

/** Close the SSE connection and cancel any pending reconnect. */
export function stopRealtime(): void {
  stopped = true;
  generation++;
  connecting = false;
  clearTimeout(reconnectTimer);
  source?.close();
  source = null;
  reconnectAttempts = 0;
}
