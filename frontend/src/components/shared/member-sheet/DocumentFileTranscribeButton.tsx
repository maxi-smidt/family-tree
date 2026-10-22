import { useEffect, useState, type ReactNode } from "react";
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

interface TranscribeAction {
  available: boolean;
  pending: boolean;
  label: string;
  buttonLabel: string;
  request: () => void;
}

/** Keep the confirmation mounted independently of transient menu triggers. */
export const DocumentFileTranscribeAction = ({
  documentId,
  file,
  children,
}: {
  documentId: string;
  file: DocumentFile;
  children: (action: TranscribeAction) => ReactNode;
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
  const available =
    canEdit && file.kind === "file" && canTranscribe(provider, file.mimeType);
  const pending = file.transcriptionStatus === "pending";
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
      {children({
        available,
        pending,
        label,
        buttonLabel: pending
          ? t("running")
          : file.hasText
            ? t("again")
            : t("start"),
        request: () => {
          if (available && !pending) setConfirming(true);
        },
      })}
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

/** Row and standalone triggers share the reader's transcription flow. */
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
}) => (
  <DocumentFileTranscribeAction documentId={documentId} file={file}>
    {({ available, pending, label, buttonLabel, request }) => {
      const failed = file.transcriptionStatus === "failed";
      if (
        !available ||
        (variant === "icon" && file.hasText && !pending && !failed)
      )
        return null;
      return variant === "button" ? (
        <Button
          type="button"
          variant="outline"
          onClick={request}
          disabled={pending}
          title={label}
          className={className}
        >
          {pending ? <Spinner /> : <Sparkles />}
          {buttonLabel}
        </Button>
      ) : (
        <button
          type="button"
          onClick={request}
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
      );
    }}
  </DocumentFileTranscribeAction>
);
