import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Calendar,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Search,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { EventDialog } from "./EventDialog";
import { Event } from "@/types/event";
import { Member } from "@/types/member";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { cn } from "@/lib/utils";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";

interface VitalEvent {
  kind: "vital";
  id: string;
  member: Member;
  type: "birth" | "death";
  date: string;
}

export const TimelineView = () => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "timeline-view.view",
  });
  const { members } = useMemberStore();
  const { events, removeEvent } = useEventStore();
  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">(
    "all",
  );
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);

  const filteredEvents = useMemo(() => {
    let filtered = events;

    if (selectedMemberId !== "all") {
      filtered = filtered.filter((e) =>
        e.linkedMemberIds.includes(selectedMemberId),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.eventType.toLowerCase().includes(query) ||
          e.location?.toLowerCase().includes(query) ||
          e.description?.toLowerCase().includes(query),
      );
    }

    return filtered.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA; // Most recent first
    });
  }, [events, selectedMemberId, searchQuery]);

  const filteredVitalEvents = useMemo(() => {
    const vitals: VitalEvent[] = [];

    for (const member of members) {
      if (member.date.birth) {
        vitals.push({
          kind: "vital",
          id: `birth-${member.id}`,
          member,
          type: "birth",
          date: member.date.birth,
        });
      }
      if (member.date.death) {
        vitals.push({
          kind: "vital",
          id: `death-${member.id}`,
          member,
          type: "death",
          date: member.date.death,
        });
      }
    }

    let filtered = vitals;

    if (selectedMemberId !== "all") {
      filtered = filtered.filter((v) => v.member.id === selectedMemberId);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          t(v.type).toLowerCase().includes(query) ||
          `${v.member.firstName} ${v.member.lastName}`
            .toLowerCase()
            .includes(query),
      );
    }

    return filtered;
  }, [members, selectedMemberId, searchQuery, t]);

  type TimelineItem =
    | { kind: "event"; data: Event }
    | { kind: "vital"; data: VitalEvent };

  const timelineItems = useMemo((): TimelineItem[] => {
    const eventItems: TimelineItem[] = filteredEvents.map((e) => ({
      kind: "event",
      data: e,
    }));
    const vitalItems: TimelineItem[] = filteredVitalEvents.map((v) => ({
      kind: "vital",
      data: v,
    }));
    return [...eventItems, ...vitalItems].sort((a, b) => {
      const dateA = new Date(a.data.date).getTime();
      const dateB = new Date(b.data.date).getTime();
      return dateB - dateA;
    });
  }, [filteredEvents, filteredVitalEvents]);

  const getMemberName = (memberId: string) => {
    const member = members.find((m) => m.id === memberId);
    return member
      ? `${member.firstName} ${member.lastName}`
      : t("member-fallback");
  };

  const getMemberNames = (memberIds: string[]) => {
    return memberIds.map(getMemberName).join(", ");
  };

  const handleAddEvent = () => {
    setEditingEvent(null);
    setIsEventDialogOpen(true);
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setIsEventDialogOpen(true);
  };

  const handleDeleteEvent = async () => {
    if (eventToDelete) {
      await removeEvent(eventToDelete.id);
      setEventToDelete(null);
    }
  };

  return (
    <ViewLayout
      title={t("title")}
      action={
        <Button size="sm" onClick={handleAddEvent}>
          <Plus />
          {t("add-event")}
        </Button>
      }
    >
      <div className="flex gap-4 mb-6 p-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("search-placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Popover open={memberSelectOpen} onOpenChange={setMemberSelectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={memberSelectOpen}
              className="w-62.5 justify-between"
            >
              {selectedMemberId === "all"
                ? t("all-members")
                : members.find((m) => m.id === selectedMemberId)
                  ? `${members.find((m) => m.id === selectedMemberId)?.firstName} ${members.find((m) => m.id === selectedMemberId)?.lastName}`
                  : t("member-place-holder")}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-62.5 p-0">
            <Command>
              <CommandInput placeholder={t("member-search-placeholder")} />
              <CommandList>
                <CommandEmpty>{t("no-member")}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      setSelectedMemberId("all");
                      setMemberSelectOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedMemberId === "all"
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {t("all-members")}
                  </CommandItem>
                  {members.map((member) => (
                    <CommandItem
                      key={member.id}
                      value={`${member.firstName} ${member.lastName}`}
                      onSelect={() => {
                        setSelectedMemberId(member.id);
                        setMemberSelectOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedMemberId === member.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {member.firstName} {member.lastName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {timelineItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Calendar className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t("no-events")}</p>
            <p className="text-sm">
              {searchQuery || selectedMemberId !== "all"
                ? t("adjust-filters")
                : t("add-an-event")}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />

            {timelineItems.map((item) =>
              item.kind === "event" ? (
                <Card
                  key={item.data.id}
                  className="relative ml-16 mb-4 p-4 hover:shadow-md transition-shadow"
                >
                  <div
                    className="absolute top-6 w-4 h-4 rounded-full bg-primary border-4 border-background"
                    style={{ left: "-40px" }}
                  />

                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">
                          {item.data.eventType}
                        </h3>
                        <span className="text-sm text-muted-foreground">
                          · {getMemberNames(item.data.linkedMemberIds)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {formatDateWithFallback(item.data.date, i18n.t)}
                          </span>
                        </div>
                        {item.data.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            <span>{item.data.location}</span>
                          </div>
                        )}
                      </div>

                      {item.data.description && (
                        <p className="text-sm">{item.data.description}</p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditEvent(item.data)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEventToDelete(item.data)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card
                  key={item.data.id}
                  className="relative ml-16 mb-4 p-4 hover:shadow-md transition-shadow"
                >
                  <div
                    className="absolute top-6 w-4 h-4 rounded-full bg-muted-foreground border-4 border-background"
                    style={{ left: "-40px" }}
                  />

                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">
                          {t(item.data.type)}
                        </h3>
                        <span className="text-sm text-muted-foreground">
                          · {getMemberName(item.data.member.id)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {formatDateWithFallback(item.data.date, i18n.t)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ),
            )}
          </div>
        )}
      </div>

      <EventDialog
        open={isEventDialogOpen}
        onOpenChange={setIsEventDialogOpen}
        event={editingEvent}
        initialMemberId={
          selectedMemberId !== "all"
            ? selectedMemberId
            : members.length > 0
              ? members[0].id
              : undefined
        }
      />

      <ConfirmDeleteDialog
        open={!!eventToDelete}
        onOpenChange={() => setEventToDelete(null)}
        onConfirm={handleDeleteEvent}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </ViewLayout>
  );
};
