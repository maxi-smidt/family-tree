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
import { useNotificationStore } from "@/hooks/useNotificationStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { refreshTaskStore } from "@/hooks/taskStoreRegistry";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { isActiveTree, useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { PresenceUserDB } from "@/types/presence";
import { NotificationDB } from "@/types/notification";

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

  // The active tree can vanish from the user's list (access revoked, tree
  // deleted, ownership transferred). loadTrees() drops the stale selection —
  // detect that here and say why the canvas just switched/emptied, instead
  // of failing silently (#813/#814).
  const reload = async () => {
    const before = useWorkspaceStore.getState().selectedTree;
    try {
      await useWorkspaceStore.getState().loadTrees();
    } catch {
      // A replacement selection may fail to open; the next event retries.
    }
    const after = useWorkspaceStore.getState().selectedTree;
    if (before && after?.id !== before.id) {
      toast.error(i18n.t("tree-view.access-revoked", { name: before.name }));
    }
  };

  const onTreeListChanged = () => void reload();

  eventSource.addEventListener("workspace.ownership_changed", onTreeListChanged);
  eventSource.addEventListener("workspace.access_changed", onTreeListChanged);
  eventSource.addEventListener("workspace.deleted", onTreeListChanged);

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
    const data = JSON.parse((e as MessageEvent).data) as { workspace_id: string };
    if (!isActiveTree(data.workspace_id)) return;
    void useActivityStore.getState().refreshActivity(data.workspace_id);
  });

  const domainRefreshers: Record<string, (workspaceId: string) => void> = {
    member: (id) => void useMemberStore.getState().refreshMembers(id),
    event: (id) => void useEventStore.getState().refreshEvents(id),
    story: (id) => void useStoryStore.getState().refreshStories(id),
    task: refreshTaskStore,
    document: (id) => void useDocumentStore.getState().refreshDocuments(id),
    gallery: (id) => void useGalleryStore.getState().refreshGalleryImages(id),
  };
  eventSource.addEventListener("workspace.content_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      workspace_id: string;
      domain: string;
      actor_user_id?: string;
    };
    if (!isActiveTree(data.workspace_id)) return;
    if (data.actor_user_id) {
      usePresenceStore.getState().markActivity(data.actor_user_id);
    }
    domainRefreshers[data.domain]?.(data.workspace_id);
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
      workspace_id: string;
      workspace_name: string;
    };
    void useWorkspaceStore.getState().loadTrees();
    toast.info(
      i18n.t("dialog.share-tree.invitation-received", { name: data.workspace_name }),
    );
  });

  // Persistent notification inbox (#726). Toasts above stay as the immediate
  // nudge; this just keeps the bell's list/badge live. No toast here — it
  // would double up with the ones already fired above for the same events.
  eventSource.addEventListener("notification.created", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as NotificationDB;
    useNotificationStore.getState().addFromEvent(data);
  });

  eventSource.addEventListener("presence.updated", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      workspace_id: string;
      users: PresenceUserDB[];
    };
    if (!isActiveTree(data.workspace_id)) return;
    usePresenceStore.getState().setRoster(data.workspace_id, data.users);
  });

  eventSource.addEventListener("workspace.layout_changed", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as {
      workspace_id: string;
      actor_user_id?: string;
    };
    if (!isActiveTree(data.workspace_id)) return;
    if (data.actor_user_id) {
      usePresenceStore.getState().markActivity(data.actor_user_id);
    }
    void useMemberStore.getState().refreshMembers(data.workspace_id);
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
      workspace_id: string;
    };
    useJobStore.getState().onDone(data.job_id, data.workspace_id);
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
      workspace_id: string;
      used_bytes: number;
      quota_bytes: number;
    };
    if (!isActiveTree(data.workspace_id)) return;
    void useStorageStore.getState().refreshStorageUsage(data.workspace_id);
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
