import {
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Spinner } from "@/components/ui/spinner";
import { downloadMedia, openMedia } from "@/hooks/useMediaUrl";
import { DocumentFile } from "@/types/document";
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
      <FileKindIcon filename={filename} mimeType={mimeType} />
    </span>
  );
};

/** Read-only list of a document's files: uploaded files preview + download,
 *  external links open in a new tab. */
export const DocumentFileList = ({ files }: { files: DocumentFile[] }) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.file",
  });
  const [openingId, setOpeningId] = useState<string | null>(null);

  if (!files.length) return null;

  const open = (f: DocumentFile) => {
    setOpeningId(f.id);
    void openMedia(f.url)
      .catch(() => toast.error(t("error-open")))
      .finally(() => setOpeningId(null));
  };
  const download = (f: DocumentFile) => {
    void downloadMedia(f.url, f.filename ?? "file").catch(() =>
      toast.error(t("error-open")),
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
          <div key={f.id} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => open(f)}
              className="flex items-center gap-2 min-w-0 flex-1 hover:underline text-left"
              title={f.filename ?? ""}
            >
              {openingId === f.id ? (
                <Spinner className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : isImageAttachment({
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
            {f.size != null && (
              <span className="text-xs text-muted-foreground shrink-0">
                {formatFileSize(f.size)}
              </span>
            )}
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
