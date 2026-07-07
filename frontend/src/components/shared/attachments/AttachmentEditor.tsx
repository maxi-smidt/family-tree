import { Dispatch, SetStateAction, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { AttachmentIcon } from "@/components/shared/attachments/AttachmentList";
import { downloadMedia } from "@/hooks/useMediaUrl";
import {
  ATTACHMENT_ACCEPT,
  attachmentError,
  formatFileSize,
  isImageAttachment,
  readFileAsDataUrl,
} from "@/utils/attachmentUtils";
import { Download, Paperclip, Plus, X } from "lucide-react";

/** An already-uploaded attachment being edited in a dialog (may be renamed or
 * removed before saving). */
export interface ExistingAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
}

/** A file the user picked in this dialog session but hasn't uploaded yet. */
export interface PendingFile {
  tempId: string;
  filename: string;
  dataUrl: string;
}

interface AttachmentEditorProps {
  /** i18n keyPrefix for the attachments block, e.g.
   * `sheet.member-sheet.stories.dialog.attachments` or
   * `sheet.member-sheet.events.dialog.attachments`. */
  keyPrefix: string;
  existing: ExistingAttachment[];
  setExisting: Dispatch<SetStateAction<ExistingAttachment[]>>;
  added: PendingFile[];
  setAdded: Dispatch<SetStateAction<PendingFile[]>>;
  fileError: string | null;
  setFileError: Dispatch<SetStateAction<string | null>>;
  maxAttachmentBytes: number | undefined;
}

/** The "Files" section of the story/event dialogs: add/rename/remove/download
 * file attachments before saving. Presentational — the owning dialog holds
 * the existing/added/fileError state and turns it into an `AttachmentOps`
 * payload on save. */
export const AttachmentEditor = ({
  keyPrefix,
  existing,
  setExisting,
  added,
  setAdded,
  fileError,
  setFileError,
  maxAttachmentBytes,
}: AttachmentEditorProps) => {
  const { t } = useTranslation(undefined, { keyPrefix });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxAttachmentSize =
    maxAttachmentBytes === undefined
      ? null
      : formatFileSize(maxAttachmentBytes);

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList) return;
    setFileError(null);
    for (const file of Array.from(fileList)) {
      const err = attachmentError(file, maxAttachmentBytes);
      if (err) {
        setFileError(t(`error-${err}`, { max: maxAttachmentSize ?? "" }));
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      setAdded((prev) => [
        ...prev,
        { tempId: crypto.randomUUID(), filename: file.name, dataUrl },
      ]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("heading")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus />
          {t("add")}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => void handleFilesPicked(e.target.files)}
      />

      {existing.length === 0 && added.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          {existing.map((a) => (
            <div key={a.id} className="flex items-center gap-2">
              <AttachmentPreview
                filename={a.filename}
                mimeType={a.mimeType}
                src={a.url}
              />
              <Input
                value={a.filename}
                onChange={(e) =>
                  setExisting((prev) =>
                    prev.map((x) =>
                      x.id === a.id ? { ...x, filename: e.target.value } : x,
                    ),
                  )
                }
                className="h-8 flex-1"
                aria-label={t("filename")}
              />
              <button
                type="button"
                onClick={() =>
                  void downloadMedia(a.url, a.filename).catch(() =>
                    toast.error(t("error-open")),
                  )
                }
                className="text-muted-foreground hover:text-foreground"
                title={t("download")}
                aria-label={t("download")}
              >
                <Download className="w-4 h-4" />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={t("remove")}
                onClick={() =>
                  setExisting((prev) => prev.filter((x) => x.id !== a.id))
                }
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}

          {added.map((a) => (
            <div key={a.tempId} className="flex items-center gap-2">
              <AttachmentPreview filename={a.filename} src={a.dataUrl} />
              <Input
                value={a.filename}
                onChange={(e) =>
                  setAdded((prev) =>
                    prev.map((x) =>
                      x.tempId === a.tempId
                        ? { ...x, filename: e.target.value }
                        : x,
                    ),
                  )
                }
                className="h-8 flex-1"
                aria-label={t("filename")}
              />
              <span className="text-xs text-muted-foreground shrink-0">
                {t("new")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={t("remove")}
                onClick={() =>
                  setAdded((prev) => prev.filter((x) => x.tempId !== a.tempId))
                }
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {fileError ? (
        <p className="text-xs text-destructive">{fileError}</p>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Paperclip className="w-3 h-3" />
          {maxAttachmentSize
            ? t("hint", { max: maxAttachmentSize })
            : t("hint-without-limit")}
        </p>
      )}
    </div>
  );
};

/** Small thumbnail (image) or file icon used in the dialog's attachment rows. */
const AttachmentPreview = ({
  filename,
  mimeType,
  src,
}: {
  filename: string;
  mimeType?: string | null;
  src: string;
}) => {
  if (isImageAttachment({ filename, mimeType })) {
    return (
      <AuthenticatedImage
        src={src}
        alt={filename}
        className="w-9 h-9 rounded object-cover border shrink-0"
      />
    );
  }
  return (
    <span className="w-9 h-9 rounded border flex items-center justify-center shrink-0">
      <AttachmentIcon filename={filename} mimeType={mimeType} />
    </span>
  );
};
