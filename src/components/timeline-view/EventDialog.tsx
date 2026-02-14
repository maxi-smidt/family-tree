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
import { Event, EventInput } from "@/types/event";
import { DatePicker } from "@/components/ui/date-picker";

interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: Event | null;
  memberId?: string;
}

export const EventDialog = ({
  open,
  onOpenChange,
  event,
  memberId,
}: EventDialogProps) => {
  const { addEvent, updateEvent } = useEventStore();
  const [formData, setFormData] = useState<EventInput>({
    eventType: "",
    date: new Date().toISOString().split("T")[0],
    location: "",
    description: "",
  });

  useEffect(() => {
    if (event) {
      setFormData({
        eventType: event.eventType,
        date: event.date,
        location: event.location || "",
        description: event.description || "",
      });
    } else {
      setFormData({
        eventType: "",
        date: new Date().toISOString().split("T")[0],
        location: "",
        description: "",
      });
    }
  }, [event, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (event) {
      await updateEvent(event.id, formData);
    } else if (memberId) {
      await addEvent(memberId, formData);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{event ? "Edit Event" : "Add Event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="eventType">Event Type *</Label>
              <Input
                id="eventType"
                value={formData.eventType}
                onChange={(e) =>
                  setFormData({ ...formData, eventType: e.target.value })
                }
                placeholder="e.g., Birth, Marriage, Graduation, Migration"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <DatePicker
                value={new Date(formData.date)}
                onChange={handleDateChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={formData.location || ""}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                placeholder="e.g., New York, USA"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Add more details about this event..."
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!formData.eventType || !memberId}>
              {event ? "Update" : "Add"} Event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
