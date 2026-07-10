import { Member } from "@/types/member";
import { useEventStore } from "@/hooks/useEventStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Calendar, Plus, Pencil, Trash2 } from "lucide-react";
import { Location } from "@/components/shared/Location";
import { EventDialog } from "@/components/view/timeline-view/EventDialog";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { useContentManager } from "@/hooks/useContentManager";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { LinkedDocumentList } from "./LinkedDocumentList";

type Props = {
  member: Member;
};

export const MemberEvents = ({ member }: Props) => {
  const { t, i18n } = useTranslation();
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
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    removeItem: removeEvent,
    memberId: member.id,
  });

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{t("sheet.member-sheet.events.title")}</ItemTitle>
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("sheet.member-sheet.events.add")}
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("sheet.member-sheet.events.no-events")}
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {events.map((event) => {
              const { icon: Icon } = getEventTypeInfo(event.eventType);
              return (
                <div
                  key={event.id}
                  className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 font-medium mb-1">
                        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        {getEventTypeLabel(event.eventType, i18n.t)}
                      </div>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span>
                            {formatDateWithFallback(event.date, i18n.t)}
                          </span>
                        </div>
                        {event.location && <Location location={event.location} />}
                      </div>
                      {event.description && (
                        <p className="text-sm mt-2">{event.description}</p>
                      )}
                      <LinkedDocumentList documentIds={event.documentIds} />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => handleEdit(event)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => openDeleteDialog(event)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
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
        title={t("sheet.member-sheet.events.delete-dialog.title")}
        description={t("sheet.member-sheet.events.delete-dialog.description")}
        cancelText={t("sheet.member-sheet.events.delete-dialog.cancel")}
        confirmText={t("sheet.member-sheet.events.delete-dialog.delete")}
      />
    </Item>
  );
};
