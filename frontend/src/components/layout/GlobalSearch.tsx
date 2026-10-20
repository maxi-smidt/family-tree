import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bookmark,
  CalendarDays,
  FileText,
  FolderTree,
  MapPin,
  Search,
  UserPlus,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceMonogram } from "@/components/shared/WorkspaceMonogram";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { SearchSnippet } from "@/components/shared/SearchSnippet";
import { shortLifeSpan } from "@/components/shared/MemberChip";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import { useDocumentSearch } from "@/hooks/useDocumentSearch";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useNavEntries } from "@/hooks/useNavEntries";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useVisibleViews } from "@/hooks/useVisibleViews";
import type { Workspace } from "@/types/workspace";
import type { DocumentSearchHit } from "@/types/document";
import { MEDIA_VIEW } from "@/lib/tabs";
import { getEventTypeLabel } from "@/types/eventTypes";
import { memberMatchesSearch } from "@/utils/memberUtils";
import { formatDate } from "@/utils/dateUtils";
import { cn } from "@/lib/utils";
import { canEditArea } from "@/utils/accessLevels";
import { NEW_PERSON_EVENT } from "@/lib/keyboardShortcuts";
import { ShortcutHint } from "@/components/ui/shortcut-hint";

const MAX_PEOPLE = 8;
const MAX_PLACES = 5;
const MAX_EVENTS = 5;
const MAX_SECTIONS = 5;
const MAX_SAVED_VIEWS = 5;
const MAX_WORKSPACES = 5;
const MAX_DOCUMENTS = 6;

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The header's search: one palette (⌘K / Ctrl K) for people, places, events,
 * sections, saved views and documents (title, description and file text,
 * searched on the server) in the open workspace, the other workspaces the
 * user can open, plus every view to jump to. Picking a person opens their
 * panel; a place opens the map on it; an event opens the timeline; a section
 * or saved view opens it on the tree; a document opens it in Documents (at
 * the matching file's text); a workspace switches to it.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "layout.search",
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const canCreatePerson = useWorkspaceStore((s) =>
    Boolean(s.isReady && s.selectedTree && canEditArea(s.selectedTree, "tree")),
  );
  const members = useMemberStore((s) => s.members);
  const setPendingLocateMemberId = useMemberStore(
    (s) => s.setPendingLocateMemberId,
  );
  const events = useEventStore((s) => s.events);
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const setMapFocus = useNavigationStore((s) => s.setMapFocus);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const { groups, open: openEntry } = useNavEntries(() => setOpen(false));
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectTree = useWorkspaceStore((s) => s.selectTree);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);
  const { visible: visibleViews, documentsAvailable } = useVisibleViews();
  const treeVisible = visibleViews.includes("tree-view");
  const setActiveView = useActiveViewStore((s) => s.setActiveView);
  const setMediaSection = useActiveViewStore((s) => s.setMediaSection);
  const setDocumentFocus = useDocumentStore((s) => s.setFocus);
  const { result: documentResult } = useDocumentSearch(query, {
    enabled: open && documentsAvailable,
    limit: MAX_DOCUMENTS,
  });
  const documentHits = documentResult?.hits ?? [];

  const sections = useSectionStore((s) => s.sections);
  const sectionsInitialized = useSectionStore((s) => s.initialized);
  const refreshSections = useSectionStore((s) => s.refreshSections);
  useDeferredStoreLoad(sectionsInitialized || !treeVisible, refreshSections);
  const savedViews = useSavedViewStore((s) => s.views);
  const viewsInitialized = useSavedViewStore((s) => s.initialized);
  const refreshSavedViews = useSavedViewStore((s) => s.refreshSavedViews);
  const openSavedView = useSavedViewStore((s) => s.openSavedView);
  useDeferredStoreLoad(viewsInitialized || !treeVisible, refreshSavedViews);
  const selectSection = useWorkspaceNavStore((s) => s.selectSection);
  const selectSavedView = useWorkspaceNavStore((s) => s.selectSavedView);
  const focusSection = useMemberStore((s) => s.focusSection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();

  const people = useMemo(
    () =>
      q
        ? members
            .filter((m) =>
              memberMatchesSearch(m, query, {
                birth: m.date.birth,
                death: m.date.death,
              }),
            )
            .slice(0, MAX_PEOPLE)
        : [],
    [members, q, query],
  );

  const places = useMemo(() => {
    if (!q) return [];
    const counts = new Map<string, number>();
    for (const m of members) {
      const all = [
        m.birthplace,
        m.hometown,
        m.cemetery,
        ...m.placesLived.map((p) => p.location),
      ];
      for (const place of new Set(all.filter((p): p is string => !!p))) {
        if (place.toLowerCase().includes(q))
          counts.set(place, (counts.get(place) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PLACES);
  }, [members, q]);

  const matchingEvents = useMemo(
    () =>
      q
        ? events
            .filter(
              (e) =>
                getEventTypeLabel(e.eventType, i18n.t)
                  .toLowerCase()
                  .includes(q) ||
                !!e.location?.toLowerCase().includes(q) ||
                !!e.description?.toLowerCase().includes(q),
            )
            .slice(0, MAX_EVENTS)
        : [],
    [events, q, i18n.t],
  );

  const matchingSections = useMemo(
    () =>
      q && treeVisible
        ? sections
            .filter((s) => s.name.toLowerCase().includes(q))
            .slice(0, MAX_SECTIONS)
        : [],
    [sections, q, treeVisible],
  );

  const matchingSavedViews = useMemo(
    () =>
      q && treeVisible
        ? savedViews
            .filter((v) => v.name.toLowerCase().includes(q))
            .slice(0, MAX_SAVED_VIEWS)
        : [],
    [savedViews, q, treeVisible],
  );

  // Every workspace the user can open (owned or shared) — the store's list
  // is already limited to those. The open one is left out: there is nothing
  // to switch to.
  const matchingWorkspaces = useMemo(
    () =>
      q
        ? workspaces
            .filter(
              (w) => w.id !== workspaceId && w.name.toLowerCase().includes(q),
            )
            .slice(0, MAX_WORKSPACES)
        : [],
    [workspaces, workspaceId, q],
  );

  const destinations = useMemo(
    () =>
      groups
        .flatMap((g) => g.entries)
        .filter((entry) => !q || entry.label.toLowerCase().includes(q)),
    [groups, q],
  );

  const openPerson = (memberId: string) => {
    setOpen(false);
    if (!workspaceId) return;
    // Open their panel and centre the canvas on them once the tree is up.
    setPendingLocateMemberId(memberId);
    setOpenSheet(workspaceId, { memberId, tab: "identity", mode: "view" });
  };

  const openPlace = (location: string) => {
    setOpen(false);
    setMapFocus({ location });
    navigateTo("map-view");
  };

  const openTimeline = () => {
    setOpen(false);
    navigateTo("timeline-view");
  };

  // Sections and saved views open on the tree, the same as picking them from
  // the canvas's "Whole family" menu.
  const openSection = (sectionId: string) => {
    guardNavigate(() => {
      setOpen(false);
      selectSection(sectionId);
      void focusSection(sectionId);
      navigateTo("tree-view");
    });
  };

  const openView = (viewId: string) => {
    guardNavigate(() => {
      setOpen(false);
      selectSavedView(viewId);
      void openSavedView(viewId).catch(() => toast.error(t("open-view-error")));
      navigateTo("tree-view");
    });
  };

  const openDocument = (hit: DocumentSearchHit) => {
    guardNavigate(() => {
      setOpen(false);
      setDocumentFocus({
        documentId: hit.documentId,
        fileId: hit.fileId,
        words: hit.matchedWords,
      });
      setMediaSection("documents");
      setActiveView(MEDIA_VIEW);
    });
  };

  const openWorkspace = (workspace: Workspace) => {
    guardNavigate(() => {
      setOpen(false);
      void selectTree(workspace).catch(() =>
        toast.error(t("open-workspace-error")),
      );
    });
  };

  const shortcut = isMac ? "⌘K" : "Ctrl K";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-input hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none max-md:w-9 max-md:justify-center max-md:px-0 md:w-56 2xl:w-72",
          className,
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left max-md:hidden">
          {t("placeholder")}
        </span>
        <kbd className="rounded border bg-background px-1.5 font-sans text-[11px] max-md:hidden">
          {shortcut}
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase [&_[cmdk-item]]:gap-3 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              className="h-12"
            />
            <CommandList className="max-h-[min(60vh,28rem)]">
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {canCreatePerson &&
                (!q || t("new-person").toLowerCase().includes(q)) && (
                  <CommandGroup heading={t("actions")}>
                    <CommandItem
                      value="action-new-person"
                      onSelect={() => {
                        setOpen(false);
                        window.dispatchEvent(new Event(NEW_PERSON_EVENT));
                      }}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">
                        <UserPlus className="size-4" />
                      </span>
                      <span className="flex-1 font-medium">
                        {t("new-person")}
                      </span>
                      <ShortcutHint shortcut="new-person" />
                    </CommandItem>
                  </CommandGroup>
                )}
              {people.length > 0 && (
                <CommandGroup heading={t("people")}>
                  {people.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`person-${m.id}`}
                      onSelect={() => openPerson(m.id)}
                    >
                      <MemberAvatar member={m} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {[m.firstName, m.lastName].filter(Boolean).join(" ")}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {shortLifeSpan(m)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {places.length > 0 && (
                <CommandGroup heading={t("places")}>
                  {places.map(([place, count]) => (
                    <CommandItem
                      key={place}
                      value={`place-${place}`}
                      onSelect={() => openPlace(place)}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <MapPin className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {place}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("people-count", { count })}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingEvents.length > 0 && (
                <CommandGroup heading={t("events")}>
                  {matchingEvents.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={`event-${e.id}`}
                      onSelect={openTimeline}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-warning-soft text-warning">
                        <CalendarDays className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {getEventTypeLabel(e.eventType, i18n.t)}
                        {e.location ? ` · ${e.location}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(e.date)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {documentHits.length > 0 && (
                <CommandGroup
                  heading={
                    documentResult?.fuzzy
                      ? t("documents-similar")
                      : t("documents")
                  }
                >
                  {documentHits.map((hit) => (
                    <CommandItem
                      key={`${hit.documentId}-${hit.field}-${hit.fileId ?? ""}`}
                      value={`document-${hit.documentId}-${hit.fileId ?? hit.field}`}
                      onSelect={() => openDocument(hit)}
                      className="items-start"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate font-medium">
                            {hit.documentTitle}
                          </span>
                          {hit.fileName && (
                            <span className="truncate text-xs text-muted-foreground">
                              {hit.page !== null
                                ? t("document-file-page", {
                                    file: hit.fileName,
                                    page: hit.page,
                                  })
                                : hit.fileName}
                            </span>
                          )}
                        </span>
                        {hit.field !== "title" && (
                          <SearchSnippet
                            text={hit.snippet}
                            highlights={hit.highlights}
                            className="line-clamp-2"
                          />
                        )}
                      </span>
                      {hit.matchCount > 1 && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {t("document-matches", { count: hit.matchCount })}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingSections.length > 0 && (
                <CommandGroup heading={t("sections")}>
                  {matchingSections.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`section-${s.id}`}
                      onSelect={() => openSection(s.id)}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <FolderTree className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {s.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("people-count", { count: s.member_count })}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingSavedViews.length > 0 && (
                <CommandGroup heading={t("saved-views")}>
                  {matchingSavedViews.map((v) => (
                    <CommandItem
                      key={v.id}
                      value={`saved-view-${v.id}`}
                      onSelect={() => openView(v.id)}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Bookmark className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {v.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingWorkspaces.length > 0 && (
                <CommandGroup heading={t("workspaces")}>
                  {matchingWorkspaces.map((w) => (
                    <CommandItem
                      key={w.id}
                      value={`workspace-${w.id}`}
                      onSelect={() => openWorkspace(w)}
                    >
                      <WorkspaceMonogram name={w.name} size="sm" muted />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {w.name}
                      </span>
                      {w.role && w.role !== "owner" && (
                        <span className="text-xs text-muted-foreground">
                          {w.role === "editor"
                            ? t("role-editor")
                            : t("role-viewer")}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {destinations.length > 0 && (
                <CommandGroup heading={t("go-to")}>
                  {destinations.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <CommandItem
                        key={entry.key}
                        value={`view-${entry.key}`}
                        onSelect={() => openEntry(entry)}
                      >
                        <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">
                          <Icon className="size-4" />
                        </span>
                        <span className="font-medium">{entry.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
