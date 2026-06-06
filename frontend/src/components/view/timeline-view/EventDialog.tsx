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
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { Event, EventInput } from "@/types/event";
import { DatePicker } from "@/components/ui/date-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTranslation } from "react-i18next";
import { getMemberOptions } from "@/utils/memberUtils";

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
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.events.dialog",
  });
  const { addEvent, updateEvent } = useEventStore();
  const { members } = useMemberStore();
  const [formData, setFormData] = useState<EventInput>({
    eventType: "",
    date: new Date().toISOString().split("T")[0],
    location: "",
    description: "",
  });
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (event) {
      setFormData({
        eventType: event.eventType,
        date: event.date,
        location: event.location || "",
        description: event.description || "",
      });
      setSelectedMemberIds(event.linkedMemberIds || []);
    } else {
      setFormData({
        eventType: "",
        date: new Date().toISOString().split("T")[0],
        location: "",
        description: "",
      });
      setSelectedMemberIds(initialMemberId ? [initialMemberId] : []);
    }
  }, [event, initialMemberId, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (event) {
      await updateEvent(event.id, formData, selectedMemberIds);
    } else {
      await addEvent(selectedMemberIds, formData);
    }

    onOpenChange(false);
  };

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData({
        ...formData,
        date: date.toISOString().split("T")[0],
      });
    }
  };

  const memberOptions = getMemberOptions(members);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>{event ? t("title-edit") : t("title-add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 py-4 px-1">
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
              <Label htmlFor="eventType">{t("event-type")} *</Label>
              <Input
                id="eventType"
                value={formData.eventType}
                onChange={(e) =>
                  setFormData({ ...formData, eventType: e.target.value })
                }
                placeholder={t("event-type-placeholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">{t("date")} *</Label>
              <DatePicker
                placeholder={t("date-placeholder")}
                value={new Date(formData.date)}
                onChange={handleDateChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">{t("location")}</Label>
              <Input
                id="location"
                value={formData.location || ""}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                placeholder={t("location-placeholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t("description")}</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t("description-placeholder")}
                rows={4}
              />
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
              disabled={!formData.eventType || selectedMemberIds.length === 0}
            >
              {event ? t("update") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
