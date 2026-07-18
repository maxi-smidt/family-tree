import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileText,
  Link as LinkIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { DocumentDialog } from "@/components/shared/member-sheet/DocumentDialog";
import { ListPagination } from "@/components/view/list-view/ListPagination";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useEventStore } from "@/hooks/useEventStore";
import { openMedia } from "@/hooks/useMediaUrl";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { type Document } from "@/types/document";
import { formatDate } from "@/utils/dateUtils";

type LinkFilter = "all" | "unlinked";

function DocumentsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-32 w-full" />
      ))}
    </div>
  );
}

export const DocumentsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "documents-view" });
  const { documents, initialized, refreshDocuments, removeDocument } =
    useDocumentStore();
  const { members } = useMemberStore();
  const {
    events,
    initialized: eventsInitialized,
    refreshEvents,
  } = useEventStore();
  const {
    stories,
    initialized: storiesInitialized,
    refreshStories,
  } = useStoryStore();
  const isReady = useTreeStore((state) => state.isReady);
  const selectedTree = useTreeStore((state) => state.selectedTree);
  const features = useAuthStore((state) => state.features);
  const restrictions = selectedTree?.restrictions ?? [];
  const canAccessEvents =
    features.includes("events") && !restrictions.includes("events");
  const canAccessStories =
    features.includes("stories") && !restrictions.includes("stories");
  const [searchTerm, setSearchTerm] = useState("");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(
    null,
  );

  useDeferredStoreLoad(initialized, refreshDocuments);
  useDeferredStoreLoad(eventsInitialized || !canAccessEvents, refreshEvents);
  useDeferredStoreLoad(storiesInitialized || !canAccessStories, refreshStories);

  useEffect(() => {
    setPage(0);
  }, [linkFilter, pageSize, searchTerm]);

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const eventsById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );
  const storiesById = useMemo(
    () => new Map(stories.map((story) => [story.id, story])),
    [stories],
  );

  const filteredDocuments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const unlinked =
        document.memberIds.length === 0 &&
        document.eventIds.length === 0 &&
        document.storyIds.length === 0;
      if (linkFilter === "unlinked" && !unlinked) return false;
      if (!normalizedSearch) return true;

      return [
        document.title,
        document.description ?? "",
        ...document.files.map((file) => file.filename ?? file.url),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [documents, linkFilter, searchTerm]);

  const pageCount = Math.ceil(filteredDocuments.length / pageSize);
  const activePage = Math.min(page, Math.max(pageCount - 1, 0));
  const pagedDocuments = filteredDocuments.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  const canWrite =
    selectedTree?.role === "owner" || selectedTree?.role === "editor";

  const handleDelete = async () => {
    if (!documentToDelete) return;
    await removeDocument(documentToDelete.id);
    setDocumentToDelete(null);
  };

  const handleAdd = () => {
    setEditingDocument(null);
    setDialogOpen(true);
  };

  const handleEdit = (document: Document) => {
    setEditingDocument(document);
    setDialogOpen(true);
  };

  return (
    <ViewLayout
      title={t("title")}
      action={
        canWrite ? (
          <Button onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        ) : undefined
      }
      toolbar={
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("search-placeholder")}
              className="pl-8"
            />
          </div>
          <Select
            value={linkFilter}
            onValueChange={(value: LinkFilter) => setLinkFilter(value)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter-all")}</SelectItem>
              <SelectItem value="unlinked">{t("filter-unlinked")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {!isReady || !initialized ? (
        <DocumentsSkeleton />
      ) : documents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border p-6 text-center">
          <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="font-medium">{t("empty-title")}</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t("empty-description")}
          </p>
          {canWrite && (
            <Button className="mt-4" onClick={handleAdd}>
              <Plus />
              {t("add")}
            </Button>
          )}
        </div>
      ) : filteredDocuments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("no-results")}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {pagedDocuments.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                canWrite={canWrite}
                membersById={membersById}
                eventsById={eventsById}
                storiesById={storiesById}
                canNavigateTimeline={canAccessEvents}
                onEdit={() => handleEdit(document)}
                onDelete={() => setDocumentToDelete(document)}
              />
            ))}
          </div>
          <ListPagination
            page={activePage}
            pageSize={pageSize}
            total={filteredDocuments.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <DocumentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        document={editingDocument}
      />
      <ConfirmDeleteDialog
        open={documentToDelete !== null}
        onOpenChange={(open) => !open && setDocumentToDelete(null)}
        onConfirm={handleDelete}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.confirm")}
      />
    </ViewLayout>
  );
};

interface DocumentCardProps {
  document: Document;
  canWrite: boolean;
  membersById: Map<string, { firstName: string; lastName: string }>;
  eventsById: Map<string, { eventType: string; date: string }>;
  storiesById: Map<string, { title: string }>;
  canNavigateTimeline: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function DocumentCard({
  document,
  canWrite,
  membersById,
  eventsById,
  storiesById,
  canNavigateTimeline,
  onEdit,
  onDelete,
}: DocumentCardProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "documents-view" });
  const treeId = useTreeStore((state) => state.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((state) => state.setOpenSheet);
  const navigateTo = useNavigationStore((state) => state.navigateTo);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fileCount = document.files.filter(
    (file) => file.kind === "file",
  ).length;
  const linkCount = document.files.length - fileCount;
  const detailsLabel = detailsOpen ? t("hide-details") : t("show-details");
  const unlinked =
    document.memberIds.length === 0 &&
    document.eventIds.length === 0 &&
    document.storyIds.length === 0;

  const openDocument = () => {
    const file = document.files.find((item) => item.kind === "file");
    const link = document.files.find((item) => item.kind === "link");
    if (file) {
      void openMedia(file.url).catch(() => toast.error(t("open-error")));
    } else if (link) {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  };

  const openMember = (memberId: string) => {
    if (!treeId) return;
    setOpenSheet(treeId, { memberId, tab: "records", mode: "view" });
  };

  return (
    <Card
      className="cursor-default p-4 transition-colors hover:bg-muted/40"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        openDocument();
      }}
      title={t("open-hint")}
    >
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-medium">{document.title}</h2>
              {document.documentDate && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(document.documentDate)}
                </p>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-expanded={detailsOpen}
                aria-label={detailsLabel}
                title={detailsLabel}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {canWrite && (
                <>
                  <div className="mx-1 h-5 border-l" aria-hidden="true" />
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("edit")}
                      title={t("edit")}
                      onClick={onEdit}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={t("delete")}
                      title={t("delete")}
                      onClick={onDelete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
          {detailsOpen && (
            <>
              {document.description && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {document.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <FileText className="h-3.5 w-3.5" />
                  {t("file-count", { count: fileCount })}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <LinkIcon className="h-3.5 w-3.5" />
                  {t("link-count", { count: linkCount })}
                </span>
                {unlinked && (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-1">
                    {t("unlinked")}
                  </span>
                )}
              </div>
              {!unlinked && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {document.memberIds.map((memberId) => {
                    const member = membersById.get(memberId);
                    const name = member
                      ? `${member.firstName} ${member.lastName}`.trim()
                      : t("unknown-member");
                    return (
                      <Button
                        key={memberId}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-48 gap-1 px-2"
                        onClick={() => openMember(memberId)}
                      >
                        <UserRound className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{name}</span>
                      </Button>
                    );
                  })}
                  {document.eventIds.map((eventId) => {
                    const event = eventsById.get(eventId);
                    const label = event
                      ? `${event.eventType} · ${formatDate(event.date)}`
                      : t("unknown-event");
                    return (
                      <Button
                        key={eventId}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-60 gap-1 px-2"
                        disabled={!canNavigateTimeline}
                        onClick={() => navigateTo("timeline-view")}
                      >
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                      </Button>
                    );
                  })}
                  {document.storyIds.map((storyId) => {
                    const story = storiesById.get(storyId);
                    return (
                      <Button
                        key={storyId}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-60 gap-1 px-2"
                        disabled={!canNavigateTimeline}
                        onClick={() => navigateTo("timeline-view")}
                      >
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {story?.title || t("unknown-story")}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
