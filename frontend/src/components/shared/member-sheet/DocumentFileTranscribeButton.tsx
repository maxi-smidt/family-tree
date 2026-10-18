import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Spinner } from "@/components/ui/spinner";
import {
  activeAiProvider,
  useAiSettingsStore,
} from "@/hooks/useAiSettingsStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { ApiError } from "@/services/api";
import { canTranscribe } from "@/types/ai";
import type { DocumentFile } from "@/types/document";
import { canEditArea } from "@/utils/accessLevels";
import { transcriptionErrorMessage } from "@/utils/transcriptionErrors";
import { cn } from "@/lib/utils";

/** Icon button next to a file that sends it to the person's own AI provider
 *  for transcription, after they confirm the data leaves the instance. Shown
 *  to editors only, and only once AI is set up in their settings. */
export const DocumentFileTranscribeButton = ({
  documentId,
  file,
  className,
}: {
  documentId: string;
  file: DocumentFile;
  className?: string;
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.ai",
  });
  const canEdit = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "sources"),
  );
  const settings = useAiSettingsStore((s) => s.settings);
  const loadSettings = useAiSettingsStore((s) => s.load);
  const transcribeFile = useDocumentStore((s) => s.transcribeFile);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (canEdit) void loadSettings().catch(() => undefined);
  }, [canEdit, loadSettings]);

  const provider = activeAiProvider(settings);
  if (
    !canEdit ||
    file.kind !== "file" ||
    !canTranscribe(provider, file.mimeType)
  )
    return null;

  const pending = file.transcriptionStatus === "pending" || starting;
  const failed = file.transcriptionStatus === "failed";
  const label = pending
    ? t("running")
    : failed
      ? t("failed", {
          error: transcriptionErrorMessage(t, file.transcriptionError),
        })
      : t("start");

  const start = async () => {
    setConfirming(false);
    setStarting(true);
    try {
      await transcribeFile(documentId, file.id);
      toast.info(t("started"));
    } catch (err) {
      const code = err instanceof ApiError ? err.message : null;
      toast.error(transcriptionErrorMessage(t, code));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className={cn(
          "shrink-0 hover:text-foreground disabled:cursor-default",
          failed
            ? "text-destructive"
            : "text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/file:opacity-100 pointer-fine:focus-visible:opacity-100",
          pending && "opacity-100 pointer-fine:opacity-100",
          className,
        )}
        title={label}
        aria-label={label}
      >
        {pending ? (
          <Spinner className="w-4 h-4" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
      </button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("confirm.title", { provider: provider?.label })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t(
                    settings?.has_api_key
                      ? "confirm.body"
                      : "confirm.body-no-key",
                    {
                      name: file.filename || t("untitled"),
                      provider: provider?.label,
                      model: settings?.model,
                    },
                  )}
                </p>
                <p className="font-medium text-foreground">
                  {t("confirm.risk")}
                </p>
                {file.hasText && <p>{t("confirm.keeps-edits")}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void start()}>
              {t("confirm.send", { provider: provider?.label })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
