import { useState, useEffect, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { Event, EventInput } from "@/types/event";
import { AttachmentOps } from "@/types/attachment";
import {
  PREDEFINED_EVENT_TYPES,
  CUSTOM_EVENT_TYPE,
  getEventTypeInfo,
} from "@/types/eventTypes";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTranslation } from "react-i18next";
import { getMemberOptions } from "@/utils/memberUtils";
import { isValidPartialDate } from "@/utils/dateUtils";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";
import { ApiError } from "@/services/api";
import { getQuotaBucket } from "@/lib/quotaError";
import { toast } from "sonner";
import { formatFileSize } from "@/utils/attachmentUtils";
import {
  AttachmentEditor,
  ExistingAttachment,
  PendingFile,
} from "@/components/shared/attachments/AttachmentEditor";

interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: Event | null;
  initialMemberId?: string;
}

export const EventDialog = ({
  open,
  onOpenChange,
  event,
  initialMemberId,
}: EventDialogProps) => {
  const { t, i18n } = useTranslation();
  const tDialog = (key: string, options?: Record<string, unknown>) =>
    t(`sheet.member-sheet.events.dialog.${key}`, options);
  const { addEvent, updateEvent } = useEventStore();
  const { members } = useMemberStore();
  const maxAttachmentBytes = useAuthStore(
    (state) => state.config?.media_limits.max_document_bytes,
  );
  const maxAttachmentSize =
    maxAttachmentBytes === undefined
      ? null
      : formatFileSize(maxAttachmentBytes);

  const [formData, setFormData] = useState<Omit<EventInput, "eventType">>({
    date: new Date().toISOString().split("T")[0],
    location: "",
    description: "",
  });
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [customLabel, setCustomLabel] = useState<string>("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
  const [geocodeStatus, setGeocodeStatus] = useState<
    "idle" | "checking" | "found" | "not-found"
  >("idle");
  const [geocodeDisplayName, setGeocodeDisplayName] = useState<string | null>(
    null,
  );
  const [existing, setExisting] = useState<ExistingAttachment[]>([]);
  const [added, setAdded] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCustom = selectedCategory === CUSTOM_EVENT_TYPE;
  const effectiveEventType = isCustom ? customLabel.trim() : selectedCategory;

  useEffect(() => {
    setFileError(null);
    setAdded([]);
    if (event) {
      setFormData({
        date: event.date,
        location: event.location || "",
        description: event.description || "",
      });
      setSelectedMemberIds(event.linkedMemberIds || []);
      const { isPredefined, predefined } = getEventTypeInfo(event.eventType);
      if (isPredefined && predefined) {
        setSelectedCategory(predefined.value);
        setCustomLabel("");
      } else {
        setSelectedCategory(CUSTOM_EVENT_TYPE);
        setCustomLabel(event.eventType);
      }
      setExisting(
        event.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          url: a.url,
          mimeType: a.mimeType,
          size: a.size,
        })),
      );
    } else {
      setFormData({
        date: new Date().toISOString().split("T")[0],
        location: "",
        description: "",
      });
      setSelectedCategory("");
      setCustomLabel("");
      setSelectedMemberIds(initialMemberId ? [initialMemberId] : []);
      setDateError(null);
      setGeocodeStatus("idle");
      setGeocodeDisplayName(null);
      setExisting([]);
    }
  }, [event, initialMemberId, open]);

  // Debounced geocode preview — shows whether the typed location resolves
  useEffect(() => {
    const loc = formData.location?.trim();
    if (!loc) {
      setGeocodeStatus("idle");
      setGeocodeDisplayName(null);
      return;
    }
    setGeocodeStatus("checking");
    const timer = setTimeout(async () => {
      const treeId = activeTreeId();
      if (!treeId) return;
      try {
        const result = await TreeService.geocodePreview(treeId, loc);
        if (result.resolved) {
          setGeocodeStatus("found");
          setGeocodeDisplayName(result.display_name);
        } else {
          setGeocodeStatus("not-found");
          setGeocodeDisplayName(null);
        }
      } catch {
        setGeocodeStatus("idle");
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [formData.location]);

  const buildAttachmentOps = useCallback((): AttachmentOps => {
    const original = event?.attachments ?? [];
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
  }, [event, existing, added]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidPartialDate(formData.date)) {
      setDateError(tDialog("date-invalid"));
      return;
    }
    setDateError(null);

    const eventInput: EventInput = {
      ...formData,
      eventType: effectiveEventType,
    };

    setSubmitting(true);
    try {
      const ops = buildAttachmentOps();
      if (event) {
        await updateEvent(event.id, eventInput, selectedMemberIds, ops);
      } else {
        await addEvent(selectedMemberIds, eventInput, ops);
      }
      onOpenChange(false);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 413) {
        const bucket = getQuotaBucket(err.message);
        if (bucket) {
          toast.error(tDialog(`attachments.error-quota-${bucket}`));
        } else {
          toast.error(
            tDialog("attachments.error-size", { max: maxAttachmentSize }),
          );
        }
      } else {
        toast.error(tDialog("attachments.error-save"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isSubmitDisabled =
    submitting || !effectiveEventType || selectedMemberIds.length === 0;

  const memberOptions = getMemberOptions(members, (name) =>
    t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {event ? tDialog("title-edit") : tDialog("title-add")}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex flex-col flex-1 min-h-0"
        >
          <div className="space-y-4 py-4 px-1 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="members">{tDialog("linked-members")} *</Label>
              <MultiSelect
                options={memberOptions}
                onValueChange={setSelectedMemberIds}
                defaultValue={selectedMemberIds}
                placeholder={tDialog("linked-members-placeholder")}
                variant="inverted"
                maxCount={5}
              />
              <p className="text-xs text-muted-foreground">
                {tDialog("linked-members-description")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventType">{tDialog("event-type")} *</Label>
              <Select
                value={selectedCategory}
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger id="eventType">
                  <SelectValue
                    placeholder={tDialog("event-type-placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {PREDEFINED_EVENT_TYPES.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          {i18n.t(`event-types.${opt.labelKey}`)}
                        </span>
                      </SelectItem>
                    );
                  })}
                  <SelectItem value={CUSTOM_EVENT_TYPE}>
                    <span className="flex items-center gap-2">
                      {tDialog("custom")}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {isCustom && (
                <Input
                  id="customLabel"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder={tDialog("custom-placeholder")}
                  required
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">{tDialog("date")} *</Label>
              <PartialDatePicker
                placeholder={tDialog("date-placeholder")}
                value={formData.date || null}
                onChange={(value) =>
                  setFormData({ ...formData, date: value ?? "" })
                }
              />
              {dateError && (
                <p className="text-sm text-destructive">{dateError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">{tDialog("location")}</Label>
              <Input
                id="location"
                value={formData.location || ""}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                placeholder={tDialog("location-placeholder")}
              />
              {geocodeStatus === "checking" && (
                <p className="text-xs text-muted-foreground">
                  {tDialog("location-checking")}
                </p>
              )}
              {geocodeStatus === "found" && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  {geocodeDisplayName || tDialog("location-found")}
                </p>
              )}
              {geocodeStatus === "not-found" && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {tDialog("location-not-found")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{tDialog("description")}</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={tDialog("description-placeholder")}
                rows={4}
              />
            </div>

            <AttachmentEditor
              keyPrefix="sheet.member-sheet.events.dialog.attachments"
              existing={existing}
              setExisting={setExisting}
              added={added}
              setAdded={setAdded}
              fileError={fileError}
              setFileError={setFileError}
              maxAttachmentBytes={maxAttachmentBytes}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {tDialog("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitDisabled}>
              {event ? tDialog("update") : tDialog("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
