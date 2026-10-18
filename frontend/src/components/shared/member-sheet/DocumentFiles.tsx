import {
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Spinner } from "@/components/ui/spinner";
import { downloadMedia, openMedia } from "@/hooks/useMediaUrl";
import { DocumentFile } from "@/types/document";
import { DocumentFileReaderTrigger } from "./DocumentFileTextDialog";
import { DocumentFileTranscribeButton } from "./DocumentFileTranscribeButton";
import { cn } from "@/lib/utils";
import {
  formatFileSize,
  getFileKind,
  isImageAttachment,
} from "@/utils/attachmentUtils";

/** Icon for a given file, picked from its name/MIME type. */
export const FileKindIcon = ({
  filename,
  mimeType,
  className = "w-4 h-4 text-muted-foreground",
}: {
  filename: string;
  mimeType?: string | null;
  className?: string;
}) => {
  const kind = getFileKind(filename, mimeType);
  const Icon =
    kind === "image"
      ? FileImage
      : kind === "sheet"
        ? FileSpreadsheet
        : kind === "file"
          ? File
          : FileText;
  return <Icon className={className} />;
};

/** Small thumbnail (image) or file-type icon used in dialog file rows. */
export const FilePreview = ({
  filename,
  mimeType,
  src,
  file,
}: {
  filename: string;
  mimeType?: string | null;
  src?: string;
  file?: File;
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (isImageAttachment({ filename, mimeType })) {
    return (
      <AuthenticatedImage
        src={src ?? previewUrl}
        alt={filename}
        className="w-9 h-9 rounded object-cover border shrink-0"
      />
    );
  }
  return (
    <span className="w-9 h-9 rounded border flex items-center justify-center shrink-0">
      <FileKindIcon filename={filename} mimeType={mimeType} />
    </span>
  );
};

/** AI and external-window actions shared by workspace and member file lists. */
export function DocumentFileActions({
  documentId,
  file,
  className,
}: {
  documentId: string;
  file: DocumentFile;
  className?: string;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.file",
  });
  const [opening, setOpening] = useState(false);
  return (
    <span
      className="contents"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <DocumentFileTranscribeButton
        documentId={documentId}
        file={file}
        className={className}
      />
      <button
        type="button"
        className={cn(
          "shrink-0 text-muted-foreground hover:text-foreground",
          className,
        )}
        title={t("open-external")}
        aria-label={t("open-external")}
        disabled={opening}
        onClick={() => {
          setOpening(true);
          void openMedia(file.url)
            .catch(() => toast.error(t("error-open")))
            .finally(() => setOpening(false));
        }}
      >
        {opening ? (
          <Spinner className="size-4" />
        ) : (
          <ExternalLink className="size-4" />
        )}
      </button>
    </span>
  );
}

/** Read-only list of a document's files: uploaded files open the reader,
 *  external links open in a new tab. */
export const DocumentFileList = ({
  documentId,
  files,
}: {
  documentId: string;
  files: DocumentFile[];
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.file",
  });

  if (!files.length) return null;

  const download = (f: DocumentFile) => {
    void downloadMedia(f.url, f.filename ?? "file").catch(() =>
      toast.error(t("error-download")),
    );
  };

  return (
    <div className="mt-2 space-y-1.5">
      {files.map((f) =>
        f.kind === "link" ? (
          <a
            key={f.id}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary underline underline-offset-2 min-w-0"
            title={f.filename ?? f.url}
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span className="truncate">{f.filename || f.url}</span>
          </a>
        ) : (
          <div
            key={f.id}
            className="group/file flex items-center gap-2 text-sm min-w-0"
          >
            <DocumentFileReaderTrigger documentId={documentId} file={f}>
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 flex-1 hover:underline text-left"
                title={f.filename ?? ""}
              >
                {isImageAttachment({
                  filename: f.filename ?? "",
                  mimeType: f.mimeType,
                }) ? (
                  <AuthenticatedImage
                    src={f.url}
                    alt={f.filename ?? ""}
                    className="w-9 h-9 rounded object-cover border shrink-0"
                  />
                ) : (
                  <FileKindIcon
                    filename={f.filename ?? ""}
                    mimeType={f.mimeType}
                  />
                )}
                <span className="truncate">{f.filename || f.url}</span>
              </button>
            </DocumentFileReaderTrigger>
            {f.size != null && (
              <span className="text-xs text-muted-foreground shrink-0">
                {formatFileSize(f.size)}
              </span>
            )}
            <DocumentFileActions documentId={documentId} file={f} />
            <button
              type="button"
              onClick={() => download(f)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={t("download")}
              aria-label={t("download")}
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        ),
      )}
    </div>
  );
};
