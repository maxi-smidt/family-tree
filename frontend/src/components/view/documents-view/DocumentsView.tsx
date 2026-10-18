import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { canEditArea } from "@/utils/accessLevels";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  FileImage,
  FileText,
  Link as LinkIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SearchInput } from "@/components/shared/SearchInput";
import { SearchSnippet } from "@/components/shared/SearchSnippet";
import { MemberChip } from "@/components/shared/MemberChip";
import { cn } from "@/lib/utils";
import type { Member } from "@/types/member";
import { CITABLE_FIELDS, type CitableField } from "@/types/citation";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { DocumentDialog } from "@/components/shared/member-sheet/DocumentDialog";
import { DocumentFileReaderTrigger } from "@/components/shared/member-sheet/DocumentFileTextDialog";
import { DocumentFileActions } from "@/components/shared/member-sheet/DocumentFiles";
import { ListPagination } from "@/components/view/list-view/ListPagination";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useCitationStore, useLoadCitations } from "@/hooks/useCitationStore";
import { type DocumentFocus, useDocumentStore } from "@/hooks/useDocumentStore";
import { useDocumentSearch } from "@/hooks/useDocumentSearch";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import {
  type Document,
  type DocumentFile,
  type DocumentSearchHit,
} from "@/types/document";
import { formatDate } from "@/utils/dateUtils";

type LinkFilter = "all" | "unlinked";

function DocumentsSkeleton() {
  return (
    <div className="shrink-0 overflow-hidden rounded-2xl border bg-card">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0"
        >
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

const isUnlinked = (document: Document) =>
  document.memberIds.length === 0 &&
  document.eventIds.length === 0 &&
  document.storyIds.length === 0;

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
  const isReady = useWorkspaceStore((state) => state.isReady);
  const selectedTree = useWorkspaceStore((state) => state.selectedTree);
  const restrictions = selectedTree?.restrictions ?? [];
  const canAccessEvents = !restrictions.includes("events");
  const canAccessStories = !restrictions.includes("stories");
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
  useLoadCitations();
  useDeferredStoreLoad(eventsInitialized || !canAccessEvents, refreshEvents);
  useDeferredStoreLoad(storiesInitialized || !canAccessStories, refreshStories);

  useEffect(() => {
    setPage(0);
  }, [linkFilter, pageSize, searchTerm]);

  // A document picked elsewhere (the search palette): show the whole list,
  // go to its page and let its row expand and open the matching text.
  const pendingFocus = useDocumentStore((s) => s.focus);
  const setPendingFocus = useDocumentStore((s) => s.setFocus);
  const [focus, setFocus] = useState<DocumentFocus | null>(null);
  useEffect(() => {
    if (!pendingFocus || !initialized) return;
    setFocus(pendingFocus);
    setPendingFocus(null);
    setSearchTerm("");
    setLinkFilter("all");
  }, [pendingFocus, initialized, setPendingFocus]);

  // File texts are searched on the server; their hits widen the filter.
  const { result: textResult, loading: textSearching } = useDocumentSearch(
    searchTerm,
    { enabled: documents.length > 0, limit: 50 },
  );
  const textHits = useMemo(() => {
    const byDocument = new Map<string, DocumentSearchHit>();
    for (const hit of textResult?.hits ?? []) {
      if (!byDocument.has(hit.documentId)) byDocument.set(hit.documentId, hit);
    }
    return byDocument;
  }, [textResult]);

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
      if (linkFilter === "unlinked" && !isUnlinked(document)) return false;
      if (!normalizedSearch) return true;

      return (
        textHits.has(document.id) ||
        [
          document.title,
          document.description ?? "",
          ...document.files.map((file) => file.filename ?? file.url),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
      );
    });
  }, [documents, linkFilter, searchTerm, textHits]);

  const unlinkedCount = useMemo(
    () => documents.filter(isUnlinked).length,
    [documents],
  );
  const peopleCovered = useMemo(
    () => new Set(documents.flatMap((d) => d.memberIds)).size,
    [documents],
  );

  useEffect(() => {
    if (!focus) return;
    const index = filteredDocuments.findIndex((d) => d.id === focus.documentId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
    // Only when a new focus arrives, not on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const pageCount = Math.ceil(filteredDocuments.length / pageSize);
  const activePage = Math.min(page, Math.max(pageCount - 1, 0));
  const pagedDocuments = filteredDocuments.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  const canWrite = !!selectedTree && canEditArea(selectedTree, "sources");

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
      contentClassName="overflow-hidden"
      subtitle={
        documents.length > 0
          ? t("subtitle", { count: documents.length, people: peopleCovered })
          : undefined
      }
      action={
        canWrite ? (
          <Button onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        ) : undefined
      }
      toolbar={
        documents.length === 0 ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="chip"
              size="sm"
              spacing={2}
              value={linkFilter}
              onValueChange={(value) =>
                value && setLinkFilter(value as LinkFilter)
              }
              aria-label={t("filter-label")}
            >
              <ToggleGroupItem value="all">
                {t("filter-all")}
                <span className="tabular-nums opacity-60">
                  {documents.length}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="unlinked">
                {t("filter-unlinked")}
                <span className="tabular-nums opacity-60">{unlinkedCount}</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="hidden flex-1 sm:block" />
            <SearchInput
              size="sm"
              containerClassName="w-full sm:w-64"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onClear={() => setSearchTerm("")}
              placeholder={t("search-placeholder")}
            />
          </div>
        )
      }
    >
      {!isReady || !initialized ? (
        <DocumentsSkeleton />
      ) : documents.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>{t("empty-title")}</EmptyTitle>
            <EmptyDescription>{t("empty-description")}</EmptyDescription>
          </EmptyHeader>
          {canWrite && (
            <EmptyContent>
              <Button onClick={handleAdd}>
                <Plus />
                {t("add")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : filteredDocuments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {textSearching ? t("searching-texts") : t("no-results")}
        </p>
      ) : (
        <>
          <ul className="min-h-0 divide-y overflow-y-auto rounded-2xl border bg-card shadow-xs">
            {pagedDocuments.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                canWrite={canWrite}
                membersById={membersById}
                eventsById={eventsById}
                storiesById={storiesById}
                canNavigateTimeline={canAccessEvents}
                textHit={
                  searchTerm.trim() ? textHits.get(document.id) : undefined
                }
                focus={focus?.documentId === document.id ? focus : null}
                onEdit={() => handleEdit(document)}
                onDelete={() => setDocumentToDelete(document)}
              />
            ))}
          </ul>
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

interface DocumentRowProps {
  document: Document;
  canWrite: boolean;
  membersById: Map<string, Member>;
  eventsById: Map<string, { eventType: string; date: string }>;
  storiesById: Map<string, { title: string }>;
  canNavigateTimeline: boolean;
  /** Where a file text search matched this document, if it did. */
  textHit?: DocumentSearchHit;
  /** Set when this document was picked in search: expand and open it. */
  focus: DocumentFocus | null;
  onEdit: () => void;
  onDelete: () => void;
}

/** The tile on the left of a row: tinted by what the document mostly is. */
function DocumentKindTile({ document }: { document: Document }) {
  const file = document.files.find((f) => f.kind === "file");
  const mime = file?.mimeType ?? "";
  const kind = file
    ? mime.startsWith("image/")
      ? "image"
      : mime === "application/pdf"
        ? "pdf"
        : "file"
    : document.files.length > 0
      ? "link"
      : "empty";
  const Icon =
    kind === "image" ? FileImage : kind === "link" ? LinkIcon : FileText;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg",
        kind === "pdf" && "bg-destructive-soft text-destructive",
        kind === "image" && "bg-warning-soft text-warning",
        kind === "link" && "bg-primary-soft text-primary",
        (kind === "file" || kind === "empty") && "bg-gender-m-bg text-gender-m",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

const MAX_ROW_PEOPLE = 2;

function DocumentRow({
  document,
  canWrite,
  membersById,
  eventsById,
  storiesById,
  canNavigateTimeline,
  textHit,
  focus,
  onEdit,
  onDelete,
}: DocumentRowProps) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "documents-view",
  });
  const workspaceId = useWorkspaceStore((state) => state.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((state) => state.setOpenSheet);
  const navigateTo = useNavigationStore((state) => state.navigateTo);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fileFocus, setFileFocus] = useState<{
    fileId: string;
    words: string[];
  } | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focus) return;
    setDetailsOpen(true);
    rowRef.current?.scrollIntoView?.({ block: "nearest" });
    if (focus.fileId)
      setFileFocus({ fileId: focus.fileId, words: focus.words });
  }, [focus]);
  const openTextHit = (hit: DocumentSearchHit) => {
    if (!hit.fileId) return;
    setDetailsOpen(true);
    setFileFocus({ fileId: hit.fileId, words: hit.matchedWords });
  };
  const attachments = document.files.filter((file) => file.kind === "file");
  const externalLinks = document.files.filter((file) => file.kind === "link");
  const detailsLabel = detailsOpen ? t("hide-details") : t("show-details");
  const people = document.memberIds
    .map((id) => membersById.get(id))
    .filter((m): m is Member => !!m);
  const allCitations = useCitationStore((state) => state.citations);
  // Which fields of whom this document is cited for, one entry per person.
  const evidence = useMemo(() => {
    const byMember = new Map<string, CitableField[]>();
    for (const citation of allCitations) {
      if (citation.documentId !== document.id) continue;
      const fields = byMember.get(citation.memberId) ?? [];
      if (!fields.includes(citation.field)) fields.push(citation.field);
      byMember.set(citation.memberId, fields);
    }
    return [...byMember.entries()].map(([memberId, fields]) => ({
      memberId,
      member: membersById.get(memberId),
      fields: CITABLE_FIELDS.filter((field) => fields.includes(field)),
    }));
  }, [allCitations, document.id, membersById]);

  const openMember = (
    memberId: string,
    tab: "records" | "identity" = "records",
  ) => {
    if (!workspaceId) return;
    setOpenSheet(workspaceId, { memberId, tab, mode: "view" });
  };

  const renderAttachment = (file: DocumentFile) => {
    const button = (
      <Button
        key={file.id}
        type="button"
        variant="outline"
        size="sm"
        className="max-w-60"
        onClick={
          file.kind === "link"
            ? () => window.open(file.url, "_blank", "noopener,noreferrer")
            : undefined
        }
      >
        {file.kind === "file" ? <FileText /> : <LinkIcon />}
        <span className="truncate">{file.filename ?? file.url}</span>
      </Button>
    );
    if (file.kind !== "file") return button;
    return (
      <span key={file.id} className="group/file inline-flex items-center gap-1">
        <DocumentFileReaderTrigger
          documentId={document.id}
          file={file}
          focusWords={fileFocus?.fileId === file.id ? fileFocus.words : null}
        >
          {button}
        </DocumentFileReaderTrigger>
        <DocumentFileActions
          documentId={document.id}
          file={file}
          className="px-1"
        />
      </span>
    );
  };

  const isInteractiveTarget = (event: MouseEvent) =>
    (event.target as HTMLElement).closest("button, a, input") !== null;

  const meta = [
    attachments.length > 0 && t("file-count", { count: attachments.length }),
    externalLinks.length > 0 &&
      t("link-count", { count: externalLinks.length }),
  ].filter(Boolean);

  return (
    <li
      ref={rowRef}
      data-slot="document-row"
      className="cursor-pointer px-5 py-3 transition-colors hover:bg-muted/40"
      onClick={(event) => {
        if (isInteractiveTarget(event)) return;
        setDetailsOpen((open) => !open);
      }}
      title={t("open-hint")}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-[2_1_16rem] items-center gap-3">
          <DocumentKindTile document={document} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{document.title}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {meta.length > 0 ? meta.join(" · ") : t("no-files")}
            </p>
            {textHit?.field === "text" && (
              <button
                type="button"
                className="mt-1 block text-left hover:underline"
                onClick={() => openTextHit(textHit)}
                title={t("open-text-hit")}
              >
                <span className="text-xs font-medium">
                  {textHit.page !== null
                    ? t("text-hit-page", {
                        file: textHit.fileName ?? "",
                        page: textHit.page,
                      })
                    : t("text-hit", { file: textHit.fileName ?? "" })}
                </span>{" "}
                <SearchSnippet
                  text={textHit.snippet}
                  highlights={textHit.highlights}
                  className="line-clamp-2"
                />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-center gap-1.5">
          {people.slice(0, MAX_ROW_PEOPLE).map((member) => (
            <MemberChip
              key={member.id}
              member={member}
              hideLife
              onOpen={openMember}
            />
          ))}
          {people.length > MAX_ROW_PEOPLE && (
            <span className="text-xs text-muted-foreground">
              +{people.length - MAX_ROW_PEOPLE}
            </span>
          )}
          {isUnlinked(document) && (
            <Badge variant="warning">{t("unlinked")}</Badge>
          )}
        </div>
        <span className="w-28 shrink-0 text-sm tabular-nums">
          {document.documentDate ? formatDate(document.documentDate) : "—"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={detailsOpen}
            aria-label={detailsLabel}
            title={detailsLabel}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <ChevronDown
              className={cn(
                "transition-transform",
                detailsOpen && "rotate-180",
              )}
            />
          </Button>
          {canWrite && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("edit")}
                title={t("edit")}
                onClick={onEdit}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                aria-label={t("delete")}
                title={t("delete")}
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      {detailsOpen && (
        <div className="mt-3 space-y-3 pl-12">
          {document.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {document.description}
            </p>
          )}
          {attachments.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {t("attachments")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {attachments.map(renderAttachment)}
              </div>
            </div>
          )}
          {externalLinks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {t("external-links")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {externalLinks.map(renderAttachment)}
              </div>
            </div>
          )}
          {people.length > MAX_ROW_PEOPLE && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {t("linked-people-heading")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {people.map((member) => (
                  <MemberChip
                    key={member.id}
                    member={member}
                    fullName
                    hideLife
                    onOpen={openMember}
                  />
                ))}
              </div>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {t("evidence-for")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {evidence.map((entry) => (
                  <button
                    key={entry.memberId}
                    type="button"
                    className="rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary-soft/70"
                    onClick={() => openMember(entry.memberId, "identity")}
                  >
                    {entry.member
                      ? `${entry.member.firstName} ${entry.member.lastName}`
                      : t("unknown-person")}{" "}
                    ·{" "}
                    {entry.fields
                      .map((field) =>
                        i18n.t(`sheet.evidence.field-lower.${field}`),
                      )
                      .join(", ")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(document.eventIds.length > 0 || document.storyIds.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
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
                    className="max-w-60"
                    disabled={!canNavigateTimeline}
                    onClick={() => navigateTo("timeline-view")}
                  >
                    <CalendarDays />
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
                    className="max-w-60"
                    disabled={!canNavigateTimeline}
                    onClick={() => navigateTo("timeline-view")}
                  >
                    <BookOpen />
                    <span className="truncate">
                      {story?.title || t("unknown-story")}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
