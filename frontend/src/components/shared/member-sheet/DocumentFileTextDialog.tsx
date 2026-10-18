import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ExternalLink, Pencil, ScrollText, Sparkles } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { MarkdownEditor } from "@/components/shared/member-sheet/MarkdownEditor";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { openMedia } from "@/hooks/useMediaUrl";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { DocumentFile, DocumentFileText } from "@/types/document";
import { canEditArea } from "@/utils/accessLevels";
import { foldForSearch, SEARCH_WORD } from "@/utils/searchFold";
import { cn } from "@/lib/utils";
import { DocumentFileTranscribeButton } from "./DocumentFileTranscribeButton";

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
}: DocumentFileTextDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.text",
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
  const contentRef = useRef<HTMLDivElement>(null);

  const showing = open && !loading && !editing && text !== null;
  useEffect(() => {
    if (!showing || !highlight?.length || !contentRef.current) return;
    return highlightWords(contentRef.current, highlight);
  }, [showing, highlight, text]);

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

  const openFile = () => {
    void openMedia(file.url).catch(() => toast.error(t("error-open")));
  };

  const name = file.filename || t("untitled");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
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

        <div className="max-h-[60vh] min-h-24 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : editing ? (
            <MarkdownEditor
              id={`document-file-text-${file.id}`}
              value={draft}
              placeholder={t("placeholder")}
              onChange={setDraft}
            />
          ) : text ? (
            <div ref={contentRef}>
              <MarkdownContent content={text.markdown} />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={openFile}>
            <ExternalLink />
            {t("open-file")}
          </Button>
          {editing ? (
            <div className="flex gap-2">
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
                disabled={saving}
              >
                {saving && <Spinner />}
                {t("save")}
              </Button>
            </div>
          ) : (
            canEdit &&
            !loading && (
              <div className="flex gap-2">
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
    </Dialog>
  );
};

/** Icon button that opens a file's text, highlighted when the file has one.
 *  Without a text it is an add button for editors only, shown on hover of
 *  the surrounding `group/file` row (always shown on touch screens). */
export const DocumentFileTextButton = ({
  documentId,
  file,
  className,
  focusWords,
}: {
  documentId: string;
  file: DocumentFile;
  className?: string;
  /** When set (a new array each time), open the text with these folded
   *  words highlighted, e.g. after picking this file in search. */
  focusWords?: string[] | null;
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.text",
  });
  const canEdit = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "sources"),
  );
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
  if (!file.hasText && !canEdit) return null;
  const label = file.hasText ? t("open") : t("open-empty");
  // React events bubble through the dialog's portal: keep clicks inside it
  // from reaching clickable rows (the documents list toggles on click).
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <span className="contents" onClick={stop} onDoubleClick={stop}>
      <DocumentFileTranscribeButton
        documentId={documentId}
        file={file}
        className={className}
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "shrink-0 hover:text-foreground",
          file.hasText
            ? "text-primary"
            : "text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/file:opacity-100 pointer-fine:focus-visible:opacity-100",
          className,
        )}
        title={label}
        aria-label={label}
      >
        <ScrollText className="w-4 h-4" />
      </button>
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
