import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ExternalLink,
  Download,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  Pencil,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Slot } from "@radix-ui/react-slot";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { MarkdownEditor } from "@/components/shared/member-sheet/MarkdownEditor";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { downloadMedia, openMedia } from "@/hooks/useMediaUrl";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { DocumentFile, DocumentFileText } from "@/types/document";
import { canEditArea } from "@/utils/accessLevels";
import { cn } from "@/lib/utils";
import { foldForSearch, SEARCH_WORD } from "@/utils/searchFold";
import { getFileKind } from "@/utils/attachmentUtils";
import { documentTextPages, replaceDocumentPage } from "@/utils/documentPages";
import { DocumentFileTranscribeButton } from "./DocumentFileTranscribeButton";
import { DocumentFilePreview } from "./DocumentFilePreview";
import {
  DocumentReaderSplit,
  DocumentReaderViewControls,
  type DocumentReaderView,
} from "./DocumentReaderSplit";
import { useCitationStore, useLoadCitations } from "@/hooks/useCitationStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { MemberFieldCitation } from "@/types/citation";
import {
  findQuoteRange,
  markRanges,
  selectionQuote,
} from "@/utils/quoteAnchor";
import {
  CitationDialog,
  type CitationDraft,
} from "@/components/shared/evidence/CitationDialog";
import { useCanEditEvidence } from "@/components/shared/evidence/useCanEditEvidence";

const CITATION_HIGHLIGHT = "document-citation";
const CITATION_FOCUS_HIGHLIGHT = "document-citation-focus";

const HIGHLIGHT = "document-search";

/** Mark every word of `root` whose folded form is in `words` with the CSS
 *  Custom Highlight API (no DOM changes, so React's tree stays untouched)
 *  and scroll the first one into view. Browsers without the API just skip
 *  the marks. Returns a cleanup. */
function highlightWords(root: HTMLElement, words: string[]): () => void {
  const highlights = (globalThis.CSS as { highlights?: HighlightRegistry })
    ?.highlights;
  if (!highlights || typeof Highlight === "undefined" || words.length === 0)
    return () => {};
  const wanted = new Set(words);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    for (const match of value.matchAll(SEARCH_WORD)) {
      if (!wanted.has(foldForSearch(match[0]))) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
  }
  if (ranges.length === 0) return () => {};
  highlights.set(HIGHLIGHT, new Highlight(...ranges));
  ranges[0].startContainer.parentElement?.scrollIntoView({ block: "center" });
  return () => highlights.delete(HIGHLIGHT);
}

interface DocumentFileTextDialogProps {
  documentId: string;
  file: DocumentFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Folded words to highlight, e.g. the matches of a document search. */
  highlight?: string[];
  /** Open on this citation: its page shown and its quote marked. */
  focusCitationId?: string | null;
}

function sourceLine(
  t: (key: string, options?: Record<string, unknown>) => string,
  text: DocumentFileText,
): string {
  if (text.source !== "ai") return t("source-manual");
  return text.model
    ? t("source-ai-model", { model: text.model })
    : t("source-ai");
}

/** Read, and with Edit on Documents write, the Markdown text of one document
 *  file. The text is loaded only when the dialog opens. */
export const DocumentFileTextDialog = ({
  documentId,
  file,
  open,
  onOpenChange,
  highlight,
  focusCitationId,
}: DocumentFileTextDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.text",
  });
  const { t: reader } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.reader",
  });
  const { t: fileText } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.file",
  });
  const loadFileText = useDocumentStore((s) => s.loadFileText);
  const saveFileText = useDocumentStore((s) => s.saveFileText);
  const canEdit = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "sources"),
  );
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<DocumentFileText | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [view, setView] = useState<DocumentReaderView>("both");
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t: evidence } = useTranslation(undefined, {
    keyPrefix: "sheet.evidence",
  });
  useLoadCitations(open);
  const allCitations = useCitationStore((s) => s.citations);
  const members = useMemberStore((s) => s.members);
  const canCite = useCanEditEvidence();
  const fileCitations = useMemo(
    () => allCitations.filter((c) => c.fileId === file.id),
    [allCitations, file.id],
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    draft: CitationDraft;
    top: number;
    left: number;
  } | null>(null);
  const [citing, setCiting] = useState<CitationDraft | null>(null);
  const isPdf = getFileKind(file.filename ?? "", file.mimeType) === "pdf";
  const markdown = editing ? draft : (text?.markdown ?? "");
  const sections = useMemo(() => documentTextPages(markdown), [markdown]);
  const paginated = isPdf && /<!--\s*page\s+0*[1-9]\d*\s*-->/i.test(markdown);
  const section = paginated
    ? sections.find((entry) => entry.page === page)
    : null;
  const pageMarkdown = paginated ? (section?.markdown ?? "") : markdown;
  const totalPages =
    pageCount ?? Math.max(1, ...sections.map((entry) => entry.page));

  useEffect(() => {
    setPage(1);
    setPageCount(null);
    setView("both");
    setEditing(false);
    setSelection(null);
    setFocusedId(open ? (focusCitationId ?? null) : null);
  }, [open, documentId, file.id, focusCitationId]);

  const focused = fileCitations.find((c) => c.id === focusedId) ?? null;
  // Show the focused citation's page: the one it names, else the page its
  // quote is on.
  useEffect(() => {
    if (!focused || !text || !isPdf) return;
    let target = focused.page;
    if (!target && focused.quote) {
      const needle = focused.quote.toLowerCase();
      target =
        documentTextPages(text.markdown).find((entry) =>
          entry.markdown.toLowerCase().includes(needle),
        )?.page ?? null;
    }
    if (target) setPage(Math.min(target, pageCount ?? target));
  }, [focused, text, isPdf, pageCount]);

  useEffect(() => {
    if (pageCount !== null) setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!open || !highlight?.length || !text || !isPdf) return;
    const wanted = new Set(highlight);
    const match = documentTextPages(text.markdown).find((entry) =>
      Array.from(entry.markdown.matchAll(SEARCH_WORD)).some((word) =>
        wanted.has(foldForSearch(word[0])),
      ),
    );
    if (match) setPage(Math.min(match.page, pageCount ?? match.page));
  }, [open, highlight, text, isPdf, pageCount]);

  const showing =
    open && view !== "document" && !loading && !editing && text !== null;
  useEffect(() => {
    if (!showing || !highlight?.length || !contentRef.current) return;
    const root = contentRef.current;
    let clear = highlightWords(root, highlight);
    // Markdown is lazy loaded; apply marks once its rendered text arrives too.
    const observer = new MutationObserver(() => {
      clear();
      clear = highlightWords(root, highlight);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clear();
    };
  }, [showing, highlight, text, page]);

  // Mark every quote cited from this file; the focused one stands out.
  const quoted = useMemo(
    () => fileCitations.filter((c) => c.quote),
    [fileCitations],
  );
  useEffect(() => {
    if (!showing || quoted.length === 0 || !contentRef.current) return;
    const root = contentRef.current;
    const mark = () => {
      const others: Range[] = [];
      let focusRange: Range | null = null;
      for (const citation of quoted) {
        const range = findQuoteRange(root, {
          quote: citation.quote ?? "",
          prefix: citation.quotePrefix,
          suffix: citation.quoteSuffix,
        });
        if (!range) continue;
        if (citation.id === focusedId) focusRange = range;
        else others.push(range);
      }
      const clearOthers = markRanges(CITATION_HIGHLIGHT, others);
      const clearFocus = markRanges(
        CITATION_FOCUS_HIGHLIGHT,
        focusRange ? [focusRange] : [],
      );
      return { clear: () => (clearOthers(), clearFocus()), focusRange };
    };
    let current = mark();
    let scrolled = false;
    const scroll = () => {
      if (scrolled || !current.focusRange) return;
      scrolled = true;
      current.focusRange.startContainer.parentElement?.scrollIntoView({
        block: "center",
      });
    };
    scroll();
    const observer = new MutationObserver(() => {
      current.clear();
      current = mark();
      scroll();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      current.clear();
    };
  }, [showing, quoted, focusedId, text, page]);

  // A selection in the text can be cited as evidence.
  const pickSelection = () => {
    const root = contentRef.current;
    const box = dialogRef.current;
    const current = window.getSelection();
    if (!canCite || !root || !box || !current || current.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    const picked = selectionQuote(root, range);
    if (!picked) {
      setSelection(null);
      return;
    }
    // jsdom and some older engines have no Range geometry.
    const rect =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : root.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    setSelection({
      draft: {
        documentId,
        fileId: file.id,
        page: paginated ? page : null,
        quote: picked.quote,
        quotePrefix: picked.prefix,
        quoteSuffix: picked.suffix,
      },
      top: rect.bottom - frame.top + 6,
      left: Math.max(8, Math.min(rect.left - frame.left, frame.width - 200)),
    });
  };

  useEffect(() => {
    if (!open) {
      setEditing(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setText(null);
    loadFileText(documentId, file.id)
      .then((loaded) => {
        if (!cancelled) setText(loaded);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("error-load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // A finished AI run changes the file's status: load its result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId, file.id, file.transcriptionStatus, loadFileText]);

  const startEditing = () => {
    setDraft(text?.markdown ?? "");
    setEditing(true);
    if (view === "document") setView("text");
  };

  const isDirty = editing && draft !== (text?.markdown ?? "");

  const save = useCallback(
    async (markdown: string = draft): Promise<boolean> => {
      setSaving(true);
      try {
        const saved = await saveFileText(documentId, file.id, markdown);
        setText(saved);
        setEditing(false);
        toast.success(t("saved"));
        return true;
      } catch {
        toast.error(t("error-save"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentId, file.id, draft, saveFileText],
  );

  useUnsavedGuard(`document-file-text-${file.id}`, isDirty, save);

  // The last AI version is kept next to an edited text; offer it back
  // (the review banner covers a version that is still waiting).
  const canRestore =
    !!text?.machineMarkdown &&
    text.machineMarkdown !== text.markdown &&
    !text.aiVersionWaiting;

  const openFile = () => {
    void openMedia(file.url).catch(() => toast.error(t("error-open")));
  };

  const downloadFile = () => {
    setDownloading(true);
    void downloadMedia(file.url, file.filename || t("untitled"))
      .catch(() => toast.error(fileText("error-download")))
      .finally(() => setDownloading(false));
  };

  const name = file.filename || t("untitled");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogRef}
        className="flex h-[calc(100dvh-1rem)] max-h-[1000px] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden p-3 sm:max-w-7xl sm:p-5"
      >
        <DialogHeader>
          <DialogTitle className="truncate pr-32">
            {t("title", { name })}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t("hint")
              : text
                ? sourceLine(t, text)
                : t("description")}
          </DialogDescription>
        </DialogHeader>
        <DocumentReaderViewControls
          view={view}
          onViewChange={(next) => {
            setSelection(null);
            setView(next);
          }}
        />

        {file.transcriptionStatus === "pending" && !editing && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t("transcribing")}
          </p>
        )}
        {canEdit && !editing && !loading && text?.aiVersionWaiting && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 shrink-0" />
              {t("machine-differs")}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void save(text.markdown)}
              >
                {t("keep-mine")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void save(text.machineMarkdown ?? text.markdown)}
              >
                {t("use-machine")}
              </Button>
            </div>
          </div>
        )}

        <DocumentReaderSplit
          view={view}
          preview={
            open && (
              <DocumentFilePreview
                key={file.id}
                file={file}
                page={page}
                onPageCount={setPageCount}
              />
            )
          }
        >
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : editing ? (
            <MarkdownEditor
              id={`document-file-text-${file.id}`}
              value={pageMarkdown}
              placeholder={t("placeholder")}
              onChange={(value) =>
                setDraft((current) =>
                  paginated ? replaceDocumentPage(current, page, value) : value,
                )
              }
            />
          ) : text ? (
            <div
              ref={contentRef}
              onMouseUp={pickSelection}
              onTouchEnd={pickSelection}
              onKeyUp={(event) => {
                if (event.shiftKey) pickSelection();
              }}
            >
              {pageMarkdown.trim() ? (
                <MarkdownContent content={pageMarkdown} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {paginated ? reader("empty-page") : t("empty")}
                </p>
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          )}
        </DocumentReaderSplit>

        {selection && !editing && (
          <Button
            type="button"
            size="sm"
            className="absolute z-10 shadow-md"
            style={{ top: selection.top, left: selection.left }}
            // Keep the text selected while the button takes the click.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setCiting(selection.draft);
              setSelection(null);
            }}
          >
            <FileCheck />
            {evidence("use-as-evidence")}
          </Button>
        )}

        {fileCitations.length > 0 && !editing && (
          <CitedInFile
            citations={fileCitations}
            members={members}
            focusedId={focusedId}
            onFocus={(id) => {
              setFocusedId(id);
              if (view === "document") setView("text");
            }}
          />
        )}

        <DialogFooter className="grid shrink-0 grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="order-2 flex flex-wrap justify-center gap-2 md:order-1 md:justify-start">
            <Button type="button" variant="outline" onClick={openFile}>
              <ExternalLink />
              {t("open-file")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={downloadFile}
              disabled={downloading}
            >
              {downloading ? <Spinner /> : <Download />}
              {fileText("download")}
            </Button>
          </div>
          {isPdf && (
            <div
              role="group"
              aria-label={reader("pages")}
              className="order-1 flex items-center justify-center gap-2 md:order-2 md:col-start-2"
            >
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={reader("previous")}
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft />
              </Button>
              <label className="flex items-center gap-2 text-sm">
                {reader("page")}
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  className="w-16"
                  aria-label={reader("page")}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (
                      Number.isInteger(value) &&
                      value >= 1 &&
                      value <= totalPages
                    )
                      setPage(value);
                  }}
                />
              </label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {reader("of", { count: totalPages })}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={reader("next")}
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
          {editing ? (
            <div className="order-3 flex flex-wrap justify-center gap-2 md:col-start-3 md:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void save()}
                shortcut="save"
                disabled={saving}
              >
                {saving && <Spinner />}
                {t("save")}
              </Button>
            </div>
          ) : (
            canEdit &&
            !loading && (
              <div className="order-3 flex flex-wrap justify-center gap-2 md:col-start-3 md:justify-end">
                {canRestore && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => setConfirmRestore(true)}
                  >
                    <RotateCcw />
                    {t("restore-ai")}
                  </Button>
                )}
                <DocumentFileTranscribeButton
                  documentId={documentId}
                  file={file}
                  variant="button"
                />
                <Button type="button" onClick={startEditing}>
                  <Pencil />
                  {text ? t("edit") : t("add")}
                </Button>
              </div>
            )
          )}
        </DialogFooter>
      </DialogContent>
      {citing && (
        <CitationDialog
          open
          onOpenChange={(next) => {
            if (!next) setCiting(null);
          }}
          draft={citing}
          suggestedMemberIds={
            useDocumentStore
              .getState()
              .documents.find((d) => d.id === documentId)?.memberIds ?? []
          }
        />
      )}
      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restore-ai-confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("restore-ai-confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void save(text?.machineMarkdown ?? text?.markdown ?? "")
              }
            >
              {t("restore-ai")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

/** "Cited in this file": who and which fields this file is evidence for.
 *  Picking one marks its quote and shows its page. */
const CitedInFile = ({
  citations,
  members,
  focusedId,
  onFocus,
}: {
  citations: MemberFieldCitation[];
  members: { id: string; firstName: string; lastName: string }[];
  focusedId: string | null;
  onFocus: (id: string) => void;
}) => {
  const { t: evidence } = useTranslation(undefined, {
    keyPrefix: "sheet.evidence",
  });
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{evidence("cited-in-file")}</span>
      {citations.map((citation) => {
        const member = members.find((m) => m.id === citation.memberId);
        const name = member
          ? `${member.firstName} ${member.lastName}`
          : evidence("unknown-person");
        const focused = citation.id === focusedId;
        return (
          <button
            key={citation.id}
            type="button"
            aria-pressed={focused}
            className={cn(
              "rounded-full bg-primary-soft px-2.5 py-1 text-primary transition-colors hover:bg-primary-soft/70",
              focused && "ring-2 ring-primary",
              citation.quoteFound === false &&
                "bg-warning-soft text-warning hover:bg-warning-soft/70",
            )}
            title={
              citation.quoteFound === false
                ? evidence("quote-not-found")
                : undefined
            }
            onClick={() => onFocus(citation.id)}
          >
            {name} · {evidence(`field-lower.${citation.field}`)}
          </button>
        );
      })}
    </div>
  );
};

/** Open the reader from a file's normal button, including files without text.
 * Search can open the same reader with its matching words highlighted. */
export const DocumentFileReaderTrigger = ({
  documentId,
  file,
  focusWords,
  children,
}: {
  documentId: string;
  file: DocumentFile;
  children: ReactElement;
  /** When set (a new array each time), open the text with these folded
   *  words highlighted, e.g. after picking this file in search. */
  focusWords?: string[] | null;
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string[] | undefined>();
  useEffect(() => {
    if (!focusWords) return;
    setHighlight(focusWords);
    setOpen(true);
  }, [focusWords]);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setHighlight(undefined);
  };
  // React events bubble through the dialog's portal: keep clicks inside it
  // from reaching clickable rows (the documents list toggles on click).
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <span className="contents" onClick={stop} onDoubleClick={stop}>
      <Slot
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </Slot>
      <DocumentFileTextDialog
        documentId={documentId}
        file={file}
        open={open}
        onOpenChange={changeOpen}
        highlight={highlight}
      />
    </span>
  );
};
