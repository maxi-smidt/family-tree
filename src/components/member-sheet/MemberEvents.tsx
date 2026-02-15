import { Member } from "@/types/member";
import { useEventStore } from "@/hooks/useEventStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Calendar, MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import { EventDialog } from "@/components/timeline-view/EventDialog";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/utils/dateUtils";
import { useContentManager } from "@/hooks/useContentManager";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";

type Props = {
  member: Member;
};

export const MemberEvents = ({ member }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.events",
  });
  const { getEventsByMember, removeEvent } = useEventStore();

  const {
    items: events,
    isDialogOpen,
    setIsDialogOpen,
    editingItem: editingEvent,
    itemToDelete: eventToDelete,
    handleAdd,
    handleEdit,
    handleDelete,
    openDeleteDialog,
    closeDeleteDialog,
  } = useContentManager({
    getItems: (id) =>
      getEventsByMember(id).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    removeItem: removeEvent,
    memberId: member.id,
  });

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{t("title")}</ItemTitle>
          <Button size="sm" variant="ghost" onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("no-events")}
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium mb-1">{event.eventType}</div>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(event.date, i18n.t)}</span>
                      </div>
                      {event.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>{event.location}</span>
                        </div>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-sm mt-2">{event.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(event)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDeleteDialog(event)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ItemContent>

      <EventDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        event={editingEvent}
        initialMemberId={member.id}
      />

      <ConfirmDeleteDialog
        open={!!eventToDelete}
        onOpenChange={closeDeleteDialog}
        onConfirm={handleDelete}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </Item>
  );
};
