import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { cn } from "@/lib/utils";
import { useCitationStore } from "@/hooks/useCitationStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import {
  CITABLE_FIELDS,
  CitableField,
  CitationAnchor,
  MemberFieldCitation,
} from "@/types/citation";
import { Document, DocumentFileText } from "@/types/document";
import { citableFieldValue } from "@/utils/citations";
import { formatDate } from "@/utils/dateUtils";
import { documentTextPages } from "@/utils/documentPages";
import {
  findQuoteRange,
  markRanges,
  selectionQuote,
} from "@/utils/quoteAnchor";

type PointsTo = "document" | "file" | "passage";

const PICK_HIGHLIGHT = "document-citation-focus";
/** The file select's value while the whole document is cited. */
const ALL_FILES = "__all__";

/** Where a new citation starts, e.g. a passage selected in the reader. */
export interface CitationDraft {
  documentId: string;
  fileId?: string | null;
  page?: number | null;
  quote?: string | null;
  quotePrefix?: string | null;
  quoteSuffix?: string | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person, when the dialog starts from their sheet. */
  memberId?: string;
  /** The field, when the dialog starts from it. */
  field?: CitableField;
  /** Edit this citation instead of adding one. */
  citation?: MemberFieldCitation;
  /** Prefill a new citation (document, file, passage). */
  draft?: CitationDraft;
  /** People to offer first when the person is still to pick. */
  suggestedMemberIds?: string[];
};

/** Add or change the evidence for one field of a person: a document, and
 *  optionally one of its files, a page and the passage that states the fact. */
export const CitationDialog = ({
  open,
  onOpenChange,
  memberId: fixedMemberId,
  field: fixedField,
  citation,
  draft,
  suggestedMemberIds = [],
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.evidence" });
  const documents = useDocumentStore((s) => s.documents);
  const refreshDocuments = useDocumentStore((s) => s.refreshDocuments);
  const loadFileText = useDocumentStore((s) => s.loadFileText);
  const members = useMemberStore((s) => s.members);
  const addCitation = useCitationStore((s) => s.addCitation);
  const updateCitation = useCitationStore((s) => s.updateCitation);

  const start = citation ?? draft;
  const [memberId, setMemberId] = useState<string | null>(
    citation?.memberId ?? fixedMemberId ?? suggestedMemberIds[0] ?? null,
  );
  const [field, setField] = useState<CitableField | null>(
    citation?.field ?? fixedField ?? null,
  );
  const [documentId, setDocumentId] = useState<string | null>(
    start?.documentId ?? null,
  );
  const startFileId = citation ? citation.fileId : (draft?.fileId ?? null);
  const [pointsTo, setPointsTo] = useState<PointsTo>(
    start?.quote ? "passage" : startFileId ? "file" : "document",
  );
  const [fileId, setFileId] = useState<string | null>(startFileId);
  const [page, setPage] = useState(start?.page ? String(start.page) : "");
  const [quote, setQuote] = useState({
    quote: start?.quote ?? "",
    prefix: start?.quotePrefix ?? "",
    suffix: start?.quoteSuffix ?? "",
  });
  const [note, setNote] = useState(citation?.note ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState<DocumentFileText | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const member = members.find((m) => m.id === memberId) ?? null;
  const document = documents.find((d) => d.id === documentId) ?? null;
  const files = document?.files ?? [];
  const file = files.find((f) => f.id === fileId) ?? null;
  const documentFixed = !!citation || !!draft?.documentId;
  const memberName = member ? `${member.firstName} ${member.lastName}` : "";

  // Pick the document's only file for "one file" and "a passage".
  useEffect(() => {
    if (pointsTo === "document" || fileId || files.length === 0) return;
    const candidates =
      pointsTo === "passage" ? files.filter((f) => f.hasText) : files;
    if (candidates.length > 0) setFileId(candidates[0].id);
  }, [pointsTo, fileId, files]);

  const passageFile = pointsTo === "passage" && file?.kind === "file";
  useEffect(() => {
    if (!open || !passageFile || !documentId || !fileId || !file?.hasText) {
      setText(null);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    loadFileText(documentId, fileId)
      .then((loaded) => {
        if (!cancelled) setText(loaded);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, passageFile, documentId, fileId, file?.hasText, loadFileText]);

  const pages = useMemo(() => {
    if (!text) return [];
    const marked = /<!--\s*page\s+0*[1-9]\d*\s*-->/i.test(text.markdown);
    return marked
      ? documentTextPages(text.markdown)
      : [{ page: 0, markdown: text.markdown }];
  }, [text]);

  // Mark the picked passage in the text.
  useEffect(() => {
    const root = textRef.current;
    if (!root || !quote.quote || !text) return;
    const mark = () => {
      const range = findQuoteRange(root, {
        quote: quote.quote,
        prefix: quote.prefix,
        suffix: quote.suffix,
      });
      return markRanges(PICK_HIGHLIGHT, range ? [range] : []);
    };
    let clear = mark();
    const observer = new MutationObserver(() => {
      clear();
      clear = mark();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clear();
    };
  }, [quote, text]);

  const pickSelection = () => {
    const root = textRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const picked = selectionQuote(root, range);
    if (!picked) return;
    setQuote(picked);
    const pageOf = (
      range.startContainer.parentElement ?? root
    ).closest<HTMLElement>("[data-page]")?.dataset.page;
    if (pageOf && pageOf !== "0") setPage(pageOf);
  };

  const sortedDocuments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = documents.filter(
      (d) =>
        !needle ||
        d.title.toLowerCase().includes(needle) ||
        (d.description ?? "").toLowerCase().includes(needle),
    );
    const linked = matches.filter(
      (d) => memberId && d.memberIds.includes(memberId),
    );
    const other = matches.filter((d) => !linked.includes(d));
    return { linked, other };
  }, [documents, search, memberId]);

  const canSave =
    !!memberId &&
    !!field &&
    !!document &&
    (pointsTo === "document" || !!fileId) &&
    (pointsTo !== "passage" || !!quote.quote) &&
    !saving;

  const save = async () => {
    if (!canSave || !memberId || !field || !document) return;
    const pageNumber = Number.parseInt(page, 10);
    const anchor: CitationAnchor = {
      fileId: pointsTo === "document" ? null : fileId,
      page:
        pointsTo !== "document" &&
        Number.isInteger(pageNumber) &&
        pageNumber > 0
          ? pageNumber
          : null,
      quote: pointsTo === "passage" ? quote.quote : null,
      quotePrefix: pointsTo === "passage" ? quote.prefix || null : null,
      quoteSuffix: pointsTo === "passage" ? quote.suffix || null : null,
      note: note.trim() || null,
    };
    setSaving(true);
    try {
      if (citation) {
        await updateCitation(citation.id, anchor);
      } else {
        await addCitation({
          memberId,
          field,
          documentId: document.id,
          ...anchor,
        });
        // Citing links the document to the person when it wasn't yet.
        if (!document.memberIds.includes(memberId)) void refreshDocuments();
      }
      toast.success(citation ? t("saved") : t("added"));
      onOpenChange(false);
    } catch {
      toast.error(t("error-save"));
    } finally {
      setSaving(false);
    }
  };

  const fieldName = field ? t(`field-lower.${field}`) : null;
  const currentValue =
    member && field
      ? displayValue(citableFieldValue(member, field), field)
      : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-4 overflow-hidden sm:max-w-4xl md:h-[min(42rem,calc(100dvh-2rem))]">
        <DialogHeader>
          <DialogTitle>
            {citation
              ? t("editor.edit-title", { field: fieldName })
              : fieldName
                ? t("editor.add-title", { field: fieldName })
                : t("editor.add-title-any")}
          </DialogTitle>
          <DialogDescription>
            {member && currentValue
              ? t("editor.current", { name: memberName, value: currentValue })
              : member
                ? memberName
                : t("editor.pick-person")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          {(!fixedMemberId || !fixedField) && !citation && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!fixedMemberId && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    {t("editor.person")}
                  </Label>
                  {suggestedMemberIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedMemberIds.map((id) => {
                        const suggested = members.find((m) => m.id === id);
                        if (!suggested) return null;
                        return (
                          <Button
                            key={id}
                            type="button"
                            size="sm"
                            variant={id === memberId ? "default" : "outline"}
                            className="h-7 rounded-full px-2.5 text-xs shadow-none"
                            aria-pressed={id === memberId}
                            onClick={() => setMemberId(id)}
                          >
                            {suggested.firstName} {suggested.lastName}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <MemberPicker
                    members={members}
                    value={memberId}
                    onChange={setMemberId}
                    placeholder={t("editor.person-placeholder")}
                    noResultsText={t("editor.person-empty")}
                    size="default"
                  />
                </div>
              )}
              {!fixedField && (
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="citation-field"
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    {t("editor.field")}
                  </Label>
                  <Select
                    value={field ?? undefined}
                    onValueChange={(value) => setField(value as CitableField)}
                  >
                    <SelectTrigger id="citation-field" className="w-full">
                      <SelectValue
                        placeholder={t("editor.field-placeholder")}
                      />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {CITABLE_FIELDS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(`field.${f}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "grid gap-4 md:min-h-0 md:flex-1",
              !documentFixed && "md:grid-cols-[16rem_minmax(0,1fr)]",
            )}
          >
            {documentFixed ? null : (
              <DocumentPicker
                linked={sortedDocuments.linked}
                other={sortedDocuments.other}
                selectedId={documentId}
                memberName={member?.firstName ?? null}
                search={search}
                onSearch={setSearch}
                onSelect={(id) => {
                  setDocumentId(id);
                  setFileId(null);
                  setQuote({ quote: "", prefix: "", suffix: "" });
                }}
              />
            )}

            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              {documentFixed && document && (
                <p className="truncate text-sm">
                  <span className="text-muted-foreground">
                    {t("editor.document")}:{" "}
                  </span>
                  <span className="font-medium">{document.title}</span>
                </p>
              )}
              {!document ? (
                <p className="flex min-h-40 flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("editor.pick-document")}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {t("editor.points-to")}
                    </span>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      value={pointsTo}
                      onValueChange={(value) =>
                        value && setPointsTo(value as PointsTo)
                      }
                    >
                      <ToggleGroupItem value="document" className="flex-1">
                        {t("editor.whole-document")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="file"
                        className="flex-1"
                        disabled={files.length === 0}
                      >
                        {t("editor.one-file")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="passage"
                        className="flex-1"
                        disabled={!files.some((f) => f.kind === "file")}
                      >
                        {t("editor.passage")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {/* File and page keep their place in every mode, so the
                      dialog doesn't jump when switching. */}
                  <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Label
                        htmlFor="citation-file"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        {t("editor.file")}
                      </Label>
                      <Select
                        value={
                          pointsTo === "document"
                            ? ALL_FILES
                            : (fileId ?? undefined)
                        }
                        disabled={pointsTo === "document" || files.length === 0}
                        onValueChange={(value) => {
                          setFileId(value);
                          setQuote({ quote: "", prefix: "", suffix: "" });
                        }}
                      >
                        <SelectTrigger
                          id="citation-file"
                          size="sm"
                          className="w-full min-w-0 [&_[data-slot=select-value]]:truncate"
                        >
                          <SelectValue placeholder={t("editor.file")} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {pointsTo === "document" && (
                            <SelectItem value={ALL_FILES}>
                              {t("editor.all-files")}
                            </SelectItem>
                          )}
                          {files
                            .filter(
                              (f) =>
                                pointsTo !== "passage" || f.kind === "file",
                            )
                            .map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.filename || t("untitled-file")}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label
                        htmlFor="citation-page"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        {t("editor.page")}
                      </Label>
                      <Input
                        id="citation-page"
                        type="number"
                        min={1}
                        className="h-8"
                        disabled={pointsTo === "document"}
                        value={pointsTo === "document" ? "" : page}
                        onChange={(event) => setPage(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex min-h-56 flex-1 flex-col gap-1.5 md:min-h-0">
                    {pointsTo !== "passage" ? (
                      <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {pointsTo === "document"
                          ? t("editor.whole-document-hint")
                          : t("editor.one-file-hint")}
                      </p>
                    ) : textLoading ? (
                      <div className="flex flex-1 items-center justify-center rounded-lg border py-8">
                        <Spinner className="size-5 text-muted-foreground" />
                      </div>
                    ) : text ? (
                      <div
                        ref={textRef}
                        data-testid="citation-passage-text"
                        className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card px-4 py-3 text-sm select-text max-md:max-h-72"
                        onMouseUp={pickSelection}
                        onTouchEnd={pickSelection}
                        onKeyUp={(event: KeyboardEvent) => {
                          if (event.shiftKey) pickSelection();
                        }}
                      >
                        {pages.map((entry) => (
                          <div key={entry.page} data-page={entry.page}>
                            <MarkdownContent content={entry.markdown} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {t("editor.no-text")}
                      </p>
                    )}
                    {pointsTo === "passage" && (
                      <p
                        className={cn(
                          "truncate rounded-md border px-3 py-1.5 text-sm",
                          !quote.quote && "text-muted-foreground",
                        )}
                        title={quote.quote || undefined}
                      >
                        <span className="font-semibold text-muted-foreground">
                          {t("editor.quote")}:{" "}
                        </span>
                        <span>
                          {quote.quote
                            ? t("editor.quoted", { quote: quote.quote })
                            : t("editor.select-hint")}
                        </span>
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="citation-note"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  {t("editor.note")}
                </Label>
                <Input
                  id="citation-note"
                  value={note}
                  maxLength={2000}
                  placeholder={t("editor.note-placeholder")}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("editor.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving && <Spinner />}
            {citation ? t("editor.save") : t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function displayValue(value: string, field: CitableField): string {
  if (!value) return "";
  return field === "date_of_birth" || field === "date_of_death"
    ? formatDate(value)
    : value;
}

const DocumentPicker = ({
  linked,
  other,
  selectedId,
  memberName,
  search,
  onSearch,
  onSelect,
}: {
  linked: Document[];
  other: Document[];
  selectedId: string | null;
  memberName: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.evidence" });
  const item = (document: Document) => {
    const selected = document.id === selectedId;
    const hasText = document.files.some((f) => f.hasText);
    return (
      <li key={document.id}>
        <button
          type="button"
          aria-pressed={selected}
          className={cn(
            "w-full rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent",
            selected && "border-primary ring-1 ring-primary",
          )}
          onClick={() => onSelect(document.id)}
        >
          <span className="block truncate text-[13px] font-semibold">
            {document.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[
              document.documentDate,
              t("files", { count: document.files.length }),
              hasText ? t("has-text") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <Label
        htmlFor="citation-document-search"
        className="text-xs font-semibold text-muted-foreground"
      >
        {t("editor.document")}
      </Label>
      <Input
        id="citation-document-search"
        value={search}
        placeholder={t("editor.search-documents")}
        onChange={(event) => onSearch(event.target.value)}
      />
      {/* Padding keeps focus and selection rings inside the scroll box. */}
      <div className="-mx-1 flex max-h-80 min-h-0 flex-col gap-2 overflow-y-auto p-1 md:max-h-none md:flex-1">
        {linked.length > 0 && (
          <>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {memberName
                ? t("editor.linked-to", { name: memberName })
                : t("editor.linked")}
            </p>
            <ul className="flex flex-col gap-1.5">{linked.map(item)}</ul>
          </>
        )}
        {other.length > 0 && (
          <>
            <p className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {linked.length > 0
                ? t("editor.other-documents")
                : t("editor.documents")}
            </p>
            <ul className="flex flex-col gap-1.5">{other.map(item)}</ul>
          </>
        )}
        {linked.length === 0 && other.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("editor.no-documents")}
          </p>
        )}
      </div>
      {memberName && (
        <p className="text-xs text-muted-foreground">
          {t("editor.links-hint", { name: memberName })}
        </p>
      )}
    </div>
  );
};
