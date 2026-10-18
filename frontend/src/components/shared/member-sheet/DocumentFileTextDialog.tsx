import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { ExternalLink, Pencil, ScrollText } from "lucide-react";
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
import { cn } from "@/lib/utils";

interface DocumentFileTextDialogProps {
  documentId: string;
  file: DocumentFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function sourceKey(text: DocumentFileText): string {
  return text.source === "ai" ? "source-ai" : "source-manual";
}

/** Read, and with Edit on Documents write, the Markdown text of one document
 *  file. The text is loaded only when the dialog opens. */
export const DocumentFileTextDialog = ({
  documentId,
  file,
  open,
  onOpenChange,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId, file.id, loadFileText]);

  const startEditing = () => {
    setDraft(text?.markdown ?? "");
    setEditing(true);
  };

  const isDirty = editing && draft !== (text?.markdown ?? "");

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const saved = await saveFileText(documentId, file.id, draft);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, file.id, draft, saveFileText]);

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
            {editing ? t("hint") : text ? t(sourceKey(text)) : t("description")}
          </DialogDescription>
        </DialogHeader>

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
            <MarkdownContent content={text.markdown} />
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
              <Button type="button" onClick={startEditing}>
                <Pencil />
                {text ? t("edit") : t("add")}
              </Button>
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
}: {
  documentId: string;
  file: DocumentFile;
  className?: string;
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.text",
  });
  const canEdit = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "sources"),
  );
  const [open, setOpen] = useState(false);
  if (!file.hasText && !canEdit) return null;
  const label = file.hasText ? t("open") : t("open-empty");
  // React events bubble through the dialog's portal: keep clicks inside it
  // from reaching clickable rows (the documents list toggles on click).
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <span className="contents" onClick={stop} onDoubleClick={stop}>
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
        onOpenChange={setOpen}
      />
    </span>
  );
};
