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
import { Button } from "@/components/ui/button";
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

/** Sends a file to the person's own AI provider for transcription, after
 *  they confirm the data leaves the instance. Editors only, and only once AI
 *  is set up in their settings. As an `icon` next to a file it stays visible
 *  while the file has no text (or a run is busy or failed); a file with a
 *  text is transcribed again from its text dialog (`button`). */
export const DocumentFileTranscribeButton = ({
  documentId,
  file,
  className,
  variant = "icon",
}: {
  documentId: string;
  file: DocumentFile;
  className?: string;
  variant?: "icon" | "button";
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

  const pending = file.transcriptionStatus === "pending";
  const failed = file.transcriptionStatus === "failed";
  if (variant === "icon" && file.hasText && !pending && !failed) return null;
  const label = pending
    ? t("running")
    : failed
      ? t("failed", {
          error: transcriptionErrorMessage(t, file.transcriptionError),
        })
      : t("start");

  const start = async () => {
    setConfirming(false);
    try {
      await transcribeFile(documentId, file.id);
      const status = useDocumentStore
        .getState()
        .documents.find((document) => document.id === documentId)
        ?.files.find((current) => current.id === file.id)?.transcriptionStatus;
      if (status === "pending") toast.info(t("started"));
    } catch (err) {
      const code = err instanceof ApiError ? err.message : null;
      toast.error(transcriptionErrorMessage(t, code));
    }
  };

  return (
    <>
      {variant === "button" ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
          disabled={pending}
          title={label}
        >
          {pending ? <Spinner /> : <Sparkles />}
          {pending ? t("running") : file.hasText ? t("again") : t("start")}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className={cn(
            "shrink-0 hover:text-foreground disabled:cursor-default",
            failed ? "text-destructive" : "text-muted-foreground",
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
      )}
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
