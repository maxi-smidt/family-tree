import { Member } from "@/types/member";
import { useEventStore } from "@/hooks/useEventStore";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { EventDialog } from "@/components/view/timeline-view/EventDialog";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback, sortByDateDesc } from "@/utils/dateUtils";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { useContentManager } from "@/hooks/useContentManager";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { LinkedDocumentList } from "./LinkedDocumentList";
import { CollapsibleEvent } from "./CollapsibleEvent";
import { RECORD_SECTION_IDS, RecordSectionCard } from "./RecordSectionCard";

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
    getItems: (id) => sortByDateDesc(getEventsByMember(id), (e) => e.date),
    removeItem: removeEvent,
    memberId: member.id,
  });

  return (
    <>
      <RecordSectionCard
        sectionId={RECORD_SECTION_IDS.events}
        title={t("sheet.member-sheet.events.title")}
        headerActions={
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("sheet.member-sheet.events.add")}
          </Button>
        }
      >
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
      </RecordSectionCard>

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
    </>
  );
};
