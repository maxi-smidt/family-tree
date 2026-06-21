import {
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { downloadMedia, openMedia } from "@/hooks/useMediaUrl";
import { StoryAttachment } from "@/types/story";
import {
  formatFileSize,
  getFileKind,
  isImageAttachment,
} from "@/utils/attachmentUtils";

/** Icon for a given file, picked from its name/MIME type. */
export const AttachmentIcon = ({
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

/** Read-only list of a story's file attachments with preview + download. */
export const StoryAttachments = ({
  attachments,
}: {
  attachments: StoryAttachment[];
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.stories.attachments",
  });

  if (!attachments.length) return null;

  const open = (a: StoryAttachment) => {
    void openMedia(a.url).catch(() => toast.error(t("error-open")));
  };
  const download = (a: StoryAttachment) => {
    void downloadMedia(a.url, a.filename).catch(() =>
      toast.error(t("error-open")),
    );
  };

  return (
    <div className="mt-2 space-y-1.5">
      {attachments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => open(a)}
            className="flex items-center gap-2 min-w-0 flex-1 hover:underline text-left"
            title={a.filename}
          >
            {isImageAttachment(a) ? (
              <AuthenticatedImage
                src={a.url}
                alt={a.filename}
                className="w-9 h-9 rounded object-cover border shrink-0"
              />
            ) : (
              <AttachmentIcon filename={a.filename} mimeType={a.mimeType} />
            )}
            <span className="truncate">{a.filename}</span>
          </button>
          {a.size != null && (
            <span className="text-xs text-muted-foreground shrink-0">
              {formatFileSize(a.size)}
            </span>
          )}
          <button
            type="button"
            onClick={() => download(a)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={t("download")}
            aria-label={t("download")}
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
