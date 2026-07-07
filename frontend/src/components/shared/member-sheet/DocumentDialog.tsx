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
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import { Download, Link as LinkIcon, Paperclip, Plus, X } from "lucide-react";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ApiError } from "@/services/api";
import { getQuotaBucket } from "@/lib/quotaError";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { getMemberOptions } from "@/utils/memberUtils";
import {
  ATTACHMENT_ACCEPT,
  attachmentError,
  formatFileSize,
  readFileAsDataUrl,
} from "@/utils/attachmentUtils";
import { downloadMedia } from "@/hooks/useMediaUrl";
import { Document, DocumentFileOps, DocumentInput } from "@/types/document";
import { FilePreview } from "./DocumentFiles";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document?: Document | null;
  initialMemberIds?: string[];
  onCreated?: (documentId: string) => void;
}

interface ExistingFile {
  id: string;
  kind: "file" | "link";
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

interface PendingLink {
  tempId: string;
  url: string;
  label: string;
}

const EMPTY_INPUT: DocumentInput = {
  title: "",
  description: "",
  documentDate: "",
};

export const DocumentDialog = ({
  open,
  onOpenChange,
  document,
  initialMemberIds,
  onCreated,
}: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.dialog",
  });
  const { addDocument, updateDocument } = useDocumentStore();
  const { members } = useMemberStore();
  const maxFileBytes = useAuthStore(
    (state) => state.config?.media_limits.max_document_bytes,
  );
  const maxFileSize =
    maxFileBytes === undefined ? null : formatFileSize(maxFileBytes);

  const [formData, setFormData] = useState<DocumentInput>(EMPTY_INPUT);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [existing, setExisting] = useState<ExistingFile[]>([]);
  const [added, setAdded] = useState<PendingFile[]>([]);
  const [addedLinks, setAddedLinks] = useState<PendingLink[]>([]);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [initialSnapshot, setInitialSnapshot] = useState<{
    formData: DocumentInput;
    selectedMemberIds: string[];
    existingJson: string;
  } | null>(null);

  useEffect(() => {
    setFileError(null);
    setAdded([]);
    setAddedLinks([]);
    setShowLinkForm(false);
    setLinkUrl("");
    setLinkLabel("");
    if (!open) {
      setInitialSnapshot(null);
      return;
    }
    if (document) {
      const files: ExistingFile[] = document.files.map((f) => ({
        id: f.id,
        kind: f.kind,
        filename: f.filename ?? "",
        url: f.url,
        mimeType: f.mimeType,
        size: f.size,
      }));
      const snap = {
        formData: {
          title: document.title,
          description: document.description ?? "",
          documentDate: document.documentDate ?? "",
        },
        selectedMemberIds: document.memberIds,
        existingJson: JSON.stringify(
          files.map((f) => ({ id: f.id, filename: f.filename })),
        ),
      };
      setInitialSnapshot(snap);
      setFormData(snap.formData);
      setSelectedMemberIds(snap.selectedMemberIds);
      setExisting(files);
    } else {
      const ids = initialMemberIds ?? [];
      setInitialSnapshot({
        formData: EMPTY_INPUT,
        selectedMemberIds: ids,
        existingJson: "[]",
      });
      setFormData(EMPTY_INPUT);
      setSelectedMemberIds(ids);
      setExisting([]);
    }
  }, [document, initialMemberIds, open]);

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList) return;
    setFileError(null);
    for (const file of Array.from(fileList)) {
      const err = attachmentError(file, maxFileBytes);
      if (err) {
        setFileError(t(`files.error-${err}`, { max: maxFileSize ?? "" }));
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

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    setAddedLinks((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), url, label: linkLabel.trim() },
    ]);
    setLinkUrl("");
    setLinkLabel("");
    setShowLinkForm(false);
  };

  const buildFileOps = (): DocumentFileOps => {
    const original = document?.files ?? [];
    const keptIds = new Set(existing.map((f) => f.id));
    const removedIds = original
      .filter((f) => !keptIds.has(f.id))
      .map((f) => f.id);
    const renamed = existing
      .filter((f) => {
        const orig = original.find((o) => o.id === f.id);
        return (
          orig &&
          (orig.filename ?? "") !== f.filename &&
          f.filename.trim() !== ""
        );
      })
      .map((f) => ({ id: f.id, filename: f.filename.trim() }));
    return {
      addedFiles: added.map((a) => ({
        filename: a.filename.trim() || "file",
        dataUrl: a.dataUrl,
      })),
      addedLinks: addedLinks.map((l) => ({
        url: l.url,
        label: l.label || undefined,
      })),
      removedIds,
      renamed,
    };
  };

  const isDirty =
    initialSnapshot !== null &&
    (formData.title !== initialSnapshot.formData.title ||
      formData.description !== initialSnapshot.formData.description ||
      formData.documentDate !== initialSnapshot.formData.documentDate ||
      JSON.stringify(selectedMemberIds) !==
        JSON.stringify(initialSnapshot.selectedMemberIds) ||
      JSON.stringify(
        existing.map((f) => ({ id: f.id, filename: f.filename })),
      ) !== initialSnapshot.existingJson ||
      added.length > 0 ||
      addedLinks.length > 0);

  const save = useCallback(async (): Promise<boolean> => {
    if (!formData.title.trim() || selectedMemberIds.length === 0) return false;
    setSubmitting(true);
    try {
      const ops = buildFileOps();
      if (document) {
        await updateDocument(document.id, formData, selectedMemberIds, ops);
      } else {
        const created = await addDocument(formData, selectedMemberIds, ops);
        if (created) onCreated?.(created.id);
      }
      onOpenChange(false);
      return true;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 413) {
        const bucket = getQuotaBucket(err.message);
        if (bucket) {
          toast.error(t(`files.error-quota-${bucket}`));
        } else {
          toast.error(t("files.error-size", { max: maxFileSize ?? "" }));
        }
      } else {
        toast.error(t("error-save"));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    document,
    formData,
    selectedMemberIds,
    existing,
    added,
    addedLinks,
    addDocument,
    updateDocument,
    onCreated,
    onOpenChange,
  ]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  useUnsavedGuard("document", isDirty, save);

  const memberOptions = getMemberOptions(members, (name) =>
    i18n.t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {document ? t("edit-title") : t("add-title")}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex flex-col flex-1 min-h-0"
        >
          <div className="space-y-4 py-4 px-1 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="doc-title">{t("title")} *</Label>
              <Input
                id="doc-title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder={t("title-placeholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-description">{t("description")}</Label>
              <Textarea
                id="doc-description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t("description-placeholder")}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("date")}</Label>
              <PartialDatePicker
                value={formData.documentDate || null}
                onChange={(value) =>
                  setFormData({ ...formData, documentDate: value ?? "" })
                }
                placeholder={t("date-placeholder")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("people-mentioned")} *</Label>
              <MultiSelect
                options={memberOptions}
                onValueChange={setSelectedMemberIds}
                defaultValue={selectedMemberIds}
                placeholder={t("people-mentioned-placeholder")}
                variant="inverted"
                maxCount={5}
              />
              <p className="text-xs text-muted-foreground">
                {t("people-mentioned-description")}
              </p>
            </div>

            {/* Files */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("files.heading")}</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus />
                    {t("files.add-file")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLinkForm(true)}
                  >
                    <LinkIcon />
                    {t("files.add-link")}
                  </Button>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => handleFilesPicked(e.target.files)}
              />

              {existing.length === 0 &&
              added.length === 0 &&
              addedLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("files.empty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {existing.map((f) => (
                    <div key={f.id} className="flex items-center gap-2">
                      {f.kind === "link" ? (
                        <span className="w-9 h-9 rounded border flex items-center justify-center shrink-0">
                          <LinkIcon className="w-4 h-4 text-muted-foreground" />
                        </span>
                      ) : (
                        <FilePreview
                          filename={f.filename}
                          mimeType={f.mimeType}
                          src={f.url}
                        />
                      )}
                      <Input
                        value={f.filename}
                        onChange={(e) =>
                          setExisting((prev) =>
                            prev.map((x) =>
                              x.id === f.id
                                ? { ...x, filename: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="h-8 flex-1"
                        aria-label={t("files.filename")}
                      />
                      {f.kind === "file" && (
                        <button
                          type="button"
                          onClick={() =>
                            void downloadMedia(f.url, f.filename).catch(() =>
                              toast.error(t("files.error-open")),
                            )
                          }
                          className="text-muted-foreground hover:text-foreground"
                          title={t("files.download")}
                          aria-label={t("files.download")}
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("files.remove")}
                        onClick={() =>
                          setExisting((prev) =>
                            prev.filter((x) => x.id !== f.id),
                          )
                        }
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}

                  {added.map((a) => (
                    <div key={a.tempId} className="flex items-center gap-2">
                      <FilePreview filename={a.filename} src={a.dataUrl} />
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
                        aria-label={t("files.filename")}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t("files.new")}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("files.remove")}
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

                  {addedLinks.map((l) => (
                    <div key={l.tempId} className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded border flex items-center justify-center shrink-0">
                        <LinkIcon className="w-4 h-4 text-muted-foreground" />
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm">
                        {l.label || l.url}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t("files.new")}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("files.remove")}
                        onClick={() =>
                          setAddedLinks((prev) =>
                            prev.filter((x) => x.tempId !== l.tempId),
                          )
                        }
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {showLinkForm && (
                <div className="border rounded-md p-2 space-y-2 bg-muted/20">
                  <Input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder={t("files.link-url-placeholder")}
                  />
                  <Input
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder={t("files.link-label-placeholder")}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" type="button" onClick={addLink}>
                      {t("files.link-add")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => {
                        setShowLinkForm(false);
                        setLinkUrl("");
                        setLinkLabel("");
                      }}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {fileError ? (
                <p className="text-xs text-destructive">{fileError}</p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  {maxFileSize
                    ? t("files.hint", { max: maxFileSize })
                    : t("files.hint-without-limit")}
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
                submitting ||
                !formData.title.trim() ||
                selectedMemberIds.length === 0
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
