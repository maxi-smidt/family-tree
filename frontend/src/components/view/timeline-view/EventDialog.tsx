import { useState, useEffect } from "react";
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
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { Event, EventInput } from "@/types/event";
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
import { DocumentLinkField } from "@/components/shared/member-sheet/DocumentLinkField";
import { GeocodeHint } from "@/components/shared/GeocodeHint";

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
  const tDialog = (key: string) => t(`sheet.member-sheet.events.dialog.${key}`);
  const { addEvent, updateEvent } = useEventStore();
  const { members } = useMemberStore();

  const [formData, setFormData] = useState<Omit<EventInput, "eventType">>({
    date: new Date().toISOString().split("T")[0],
    location: "",
    description: "",
  });
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [customLabel, setCustomLabel] = useState<string>("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);

  const isCustom = selectedCategory === CUSTOM_EVENT_TYPE;
  const effectiveEventType = isCustom ? customLabel.trim() : selectedCategory;

  useEffect(() => {
    if (event) {
      setFormData({
        date: event.date,
        location: event.location || "",
        description: event.description || "",
      });
      setSelectedMemberIds(event.linkedMemberIds || []);
      setSelectedDocumentIds(event.documentIds || []);
      const { isPredefined, predefined } = getEventTypeInfo(event.eventType);
      if (isPredefined && predefined) {
        setSelectedCategory(predefined.value);
        setCustomLabel("");
      } else {
        setSelectedCategory(CUSTOM_EVENT_TYPE);
        setCustomLabel(event.eventType);
      }
    } else {
      setFormData({
        date: new Date().toISOString().split("T")[0],
        location: "",
        description: "",
      });
      setSelectedCategory("");
      setCustomLabel("");
      setSelectedMemberIds(initialMemberId ? [initialMemberId] : []);
      setSelectedDocumentIds([]);
      setDateError(null);
    }
  }, [event, initialMemberId, open]);

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

    if (event) {
      await updateEvent(
        event.id,
        eventInput,
        selectedMemberIds,
        selectedDocumentIds,
      );
    } else {
      await addEvent(selectedMemberIds, eventInput, selectedDocumentIds);
    }

    onOpenChange(false);
  };

  const isSubmitDisabled =
    !effectiveEventType || selectedMemberIds.length === 0;

  const memberOptions = getMemberOptions(members, (name) =>
    t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {event ? tDialog("title-edit") : tDialog("title-add")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 py-4 px-1">
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
              <GeocodeHint location={formData.location} />
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

            <DocumentLinkField
              documentIds={selectedDocumentIds}
              onChange={setSelectedDocumentIds}
              seedMemberIds={selectedMemberIds}
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
