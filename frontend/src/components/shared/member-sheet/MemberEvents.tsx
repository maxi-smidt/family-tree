import { Member } from "@/types/member";
import { useEventStore } from "@/hooks/useEventStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { EventDialog } from "@/components/view/timeline-view/EventDialog";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { useContentManager } from "@/hooks/useContentManager";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { LinkedDocumentList } from "./LinkedDocumentList";
import { CollapsibleEvent } from "./CollapsibleEvent";

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
                <CollapsibleEvent
                  key={event.id}
                  icon={Icon}
                  typeLabel={getEventTypeLabel(event.eventType, i18n.t)}
                  date={formatDateWithFallback(event.date, i18n.t)}
                  location={event.location}
                  description={event.description}
                  actions={
                    <>
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
                    </>
                  }
                >
                  <LinkedDocumentList documentIds={event.documentIds} />
                </CollapsibleEvent>
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
