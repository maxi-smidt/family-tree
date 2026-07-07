import { useState, useEffect, useRef, useCallback, FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ApiError } from "@/services/api";
import { getQuotaBucket } from "@/lib/quotaError";
import { toast } from "sonner";
import { AttachmentOps, Story, StoryInput } from "@/types/story";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTranslation } from "react-i18next";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { getMemberOptions } from "@/utils/memberUtils";
import {
  ATTACHMENT_ACCEPT,
  attachmentError,
  formatFileSize,
  isImageAttachment,
  readFileAsDataUrl,
} from "@/utils/attachmentUtils";
import { AttachmentIcon } from "./StoryAttachments";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { downloadMedia } from "@/hooks/useMediaUrl";
import { Download, Paperclip, Plus, X } from "lucide-react";

interface StoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  story?: Story | null;
  initialMemberId?: string;
}

interface ExistingAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
}

interface PendingFile {
  tempId: string;
  filename: string;
  dataUrl: string;
}

export const StoryDialog = ({
  open,
  onOpenChange,
  story,
  initialMemberId,
}: StoryDialogProps) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.stories.dialog",
  });
  const { addStory, updateStory } = useStoryStore();
  const { members } = useMemberStore();
  const maxAttachmentBytes = useAuthStore(
    (state) => state.config?.media_limits.max_document_bytes,
  );
  const maxAttachmentSize =
    maxAttachmentBytes === undefined
      ? null
      : formatFileSize(maxAttachmentBytes);
  const [formData, setFormData] = useState<StoryInput>({
    title: "",
    content: "",
  });
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [existing, setExisting] = useState<ExistingAttachment[]>([]);
  const [added, setAdded] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [initialSnapshot, setInitialSnapshot] = useState<{
    formData: StoryInput;
    selectedMemberIds: string[];
    existingJson: string;
  } | null>(null);

  useEffect(() => {
    setFileError(null);
    setAdded([]);
    if (!open) {
      setInitialSnapshot(null);
      return;
    }
    if (story) {
      const snap = {
        formData: { title: story.title, content: story.content },
        selectedMemberIds: story.linkedMemberIds || [],
        existingJson: JSON.stringify(
          story.attachments.map((a) => ({ id: a.id, filename: a.filename })),
        ),
      };
      setInitialSnapshot(snap);
      setFormData(snap.formData);
      setSelectedMemberIds(snap.selectedMemberIds);
      setExisting(
        story.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          url: a.url,
          mimeType: a.mimeType,
          size: a.size,
        })),
      );
    } else {
      const ids = initialMemberId ? [initialMemberId] : [];
      setInitialSnapshot({
        formData: { title: "", content: "" },
        selectedMemberIds: ids,
        existingJson: "[]",
      });
      setFormData({ title: "", content: "" });
      setSelectedMemberIds(ids);
      setExisting([]);
    }
  }, [story, initialMemberId, open]);

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList) return;
    setFileError(null);
    for (const file of Array.from(fileList)) {
      const err = attachmentError(file, maxAttachmentBytes);
      if (err) {
        setFileError(
          t(`attachments.error-${err}`, { max: maxAttachmentSize ?? "" }),
        );
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

  const buildAttachmentOps = (): AttachmentOps => {
    const original = story?.attachments ?? [];
    const keptIds = new Set(existing.map((a) => a.id));
    const removedIds = original
      .filter((a) => !keptIds.has(a.id))
      .map((a) => a.id);
    const renamed = existing
      .filter((a) => {
        const orig = original.find((o) => o.id === a.id);
        return orig && orig.filename !== a.filename && a.filename.trim() !== "";
      })
      .map((a) => ({ id: a.id, filename: a.filename.trim() }));
    const addedOps = added.map((a) => ({
      filename: a.filename.trim() || "file",
      dataUrl: a.dataUrl,
    }));
    return { added: addedOps, removedIds, renamed };
  };

  const isDirty =
    initialSnapshot !== null &&
    (formData.title !== initialSnapshot.formData.title ||
      formData.content !== initialSnapshot.formData.content ||
      JSON.stringify(selectedMemberIds) !==
        JSON.stringify(initialSnapshot.selectedMemberIds) ||
      JSON.stringify(
        existing.map((a) => ({ id: a.id, filename: a.filename })),
      ) !== initialSnapshot.existingJson ||
      added.length > 0);

  const save = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      const ops = buildAttachmentOps();
      if (story) {
        await updateStory(story.id, formData, selectedMemberIds, ops);
      } else {
        await addStory(selectedMemberIds, formData, ops);
      }
      onOpenChange(false);
      return true;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 413) {
        const bucket = getQuotaBucket(err.message);
        if (bucket) {
          toast.error(t(`attachments.error-quota-${bucket}`));
        } else {
          toast.error(t("attachments.error-size", { max: maxAttachmentSize }));
        }
      } else {
        toast.error(t("attachments.error-save"));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    story,
    formData,
    selectedMemberIds,
    existing,
    added,
    addStory,
    updateStory,
    onOpenChange,
  ]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  useUnsavedGuard("story", isDirty, save);

  const memberOptions = getMemberOptions(members, (name) =>
    i18n.t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{story ? t("title-edit") : t("title-add")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex flex-col flex-1 min-h-0"
        >
          <div className="space-y-4 py-4 px-1 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="members">{t("linked-members")} *</Label>
              <MultiSelect
                options={memberOptions}
                onValueChange={setSelectedMemberIds}
                defaultValue={selectedMemberIds}
                placeholder={t("linked-members-placeholder")}
                variant="inverted"
                maxCount={5}
              />
              <p className="text-xs text-muted-foreground">
                {t("linked-members-description")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">{t("title")} *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder={t("title-placeholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">{t("story")}</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder={t("story-placeholder")}
                rows={10}
                className="resize-none"
              />
            </div>

            {/* Files */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("attachments.heading")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus />
                  {t("attachments.add")}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => handleFilesPicked(e.target.files)}
              />

              {existing.length === 0 && added.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("attachments.empty")}
                </p>
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
                              x.id === a.id
                                ? { ...x, filename: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="h-8 flex-1"
                        aria-label={t("attachments.filename")}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void downloadMedia(a.url, a.filename).catch(() =>
                            toast.error(t("attachments.error-open")),
                          )
                        }
                        className="text-muted-foreground hover:text-foreground"
                        title={t("attachments.download")}
                        aria-label={t("attachments.download")}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("attachments.remove")}
                        onClick={() =>
                          setExisting((prev) =>
                            prev.filter((x) => x.id !== a.id),
                          )
                        }
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}

                  {added.map((a) => (
                    <div key={a.tempId} className="flex items-center gap-2">
                      <AttachmentPreview
                        filename={a.filename}
                        src={a.dataUrl}
                      />
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
                        aria-label={t("attachments.filename")}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t("attachments.new")}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("attachments.remove")}
                        onClick={() =>
                          setAdded((prev) =>
                            prev.filter((x) => x.tempId !== a.tempId),
                          )
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
                    ? t("attachments.hint", { max: maxAttachmentSize })
                    : t("attachments.hint-without-limit")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                submitting || !formData.title || selectedMemberIds.length === 0
              }
            >
              {story ? t("update") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
