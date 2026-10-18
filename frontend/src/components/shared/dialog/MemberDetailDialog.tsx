import { Member, isDeceased } from "@/types/member";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { MemberFamily } from "@/components/shared/member-sheet/MemberFamily";
import { useMemberLife } from "@/hooks/useMemberLife";
import { Button } from "@/components/ui/button";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ImageLightbox } from "@/components/shared/member-sheet/ImageLightbox";
import { CollapsibleStory } from "@/components/shared/member-sheet/CollapsibleStory";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Calendar, BookOpen, Images, Activity, X } from "lucide-react";
import { Location } from "@/components/shared/Location";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import {
  formatDate,
  formatDateWithFallback,
  sortByDateDesc,
} from "@/utils/dateUtils";
import { getEventTypeLabel, getEventTypeInfo } from "@/types/eventTypes";
import { Badge } from "@/components/ui/badge";
import { CollapsibleEvent } from "@/components/shared/member-sheet/CollapsibleEvent";

type Props = {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const MemberDetailDialog = ({ member, open, onOpenChange }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "dialog.member-detail",
  });
  const {
    galleryImages,
    refreshGalleryImages,
    initialized: galleryInitialized,
  } = useGalleryStore();
  const {
    getEventsByMember,
    refreshEvents,
    initialized: eventsInitialized,
  } = useEventStore();
  const {
    getStoriesByMember,
    refreshStories,
    initialized: storiesInitialized,
  } = useStoryStore();
  const { members, fetchMemberDetail, detailLoadedIds } = useMemberStore();
  const [navigation, setNavigation] = useState<{
    rootId: string;
    id: string;
  } | null>(null);
  const displayedId =
    navigation?.rootId === member?.id ? navigation?.id : member?.id;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    if (!open) {
      setNavigation(null);
      setLightboxOpen(false);
      return;
    }
    if (!displayedId) return;
    let active = true;
    setIsLoadingDetail(!detailLoadedIds.has(displayedId));
    void fetchMemberDetail(displayedId).finally(() => {
      if (active) setIsLoadingDetail(false);
    });
    return () => {
      active = false;
    };
  }, [open, displayedId, fetchMemberDetail]); // detailLoadedIds is a cache snapshot

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setLightboxOpen(false);
  }, [displayedId]);

  // Defer secondary-domain stores until the dialog opens (no-op while closed).
  useDeferredStoreLoad(eventsInitialized || !open, refreshEvents);
  useDeferredStoreLoad(storiesInitialized || !open, refreshStories);
  useDeferredStoreLoad(galleryInitialized || !open, refreshGalleryImages);

  if (!member) return null;

  // Always reflect the latest store data rather than the snapshot passed as prop
  const currentMember = members.find((m) => m.id === displayedId) ?? member;

  const linkedImages = (galleryImages || []).filter((image) => {
    const linkedIds = Array.isArray(image.linkedMemberIds)
      ? image.linkedMemberIds
      : [];
    return linkedIds.includes(currentMember.id);
  });

  const memberEvents = sortByDateDesc(
    getEventsByMember(currentMember.id),
    (event) => event.date,
  );

  const memberStories = getStoriesByMember(currentMember.id);
  const memberDiseases = currentMember.diseases ?? [];

  const openLightbox = (index: number) => {
    setStartIndex(index);
    setLightboxOpen(true);
  };

  const hasLocations = !!(
    currentMember.birthplace ||
    currentMember.hometown ||
    currentMember.cemetery ||
    currentMember.placesLived.length > 0
  );

  const getStatusBadgeVariant = (
    status: string,
  ): "destructive" | "secondary" | "outline" => {
    if (status === "affected") return "destructive";
    if (status === "carrier") return "secondary";
    return "outline";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-5xl"
        >
          <DialogHeader className="relative shrink-0 border-b px-6 py-6 text-left sm:px-8 sm:py-7">
            <PersonHeader member={currentMember} />
            {isLoadingDetail && (
              <Spinner className="absolute bottom-4 right-6 size-4 text-muted-foreground" />
            )}
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3"
                aria-label={i18n.t("sheet.member-sheet.close")}
              >
                <X />
              </Button>
            </DialogClose>
          </DialogHeader>

          <div ref={scrollRef} className="min-h-0 overflow-y-auto">
            <div className="grid items-start gap-8 p-6 sm:p-8 lg:has-[[data-member-family]]:grid-cols-[minmax(0,1fr)_17rem]">
              <section
                className="min-w-0"
                aria-labelledby="person-details-heading"
              >
                <h3
                  id="person-details-heading"
                  className="mb-3 text-base font-semibold"
                >
                  {i18n.t("sheet.view-mode.details-heading")}
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl border bg-card p-5 [&_[data-slot=item-description]]:line-clamp-none [&_[data-slot=item-description]]:break-words [&_[data-slot=item-description]]:text-pretty">
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("firstname")}</ItemTitle>
                      <ItemDescription className="text-foreground">
                        {currentMember.firstName}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("lastname")}</ItemTitle>
                      <ItemDescription className="text-foreground">
                        {currentMember.lastName}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  {currentMember.maidenName && (
                    <Item variant="field">
                      <ItemContent>
                        <ItemTitle>{t("maiden")}</ItemTitle>
                        <ItemDescription className="text-foreground">
                          {currentMember.maidenName}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  )}
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("gender")}</ItemTitle>
                      <ItemDescription className="capitalize text-foreground">
                        {i18n.t(`common.gender.${currentMember.gender}`)}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("dob")}</ItemTitle>
                      <ItemDescription className="text-foreground">
                        {formatDateWithFallback(
                          currentMember.date.birth,
                          i18n.t,
                        )}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("dod")}</ItemTitle>
                      <ItemDescription className="text-foreground">
                        {currentMember.date.death ? (
                          formatDate(currentMember.date.death)
                        ) : (
                          <i>
                            {isDeceased(currentMember)
                              ? i18n.t("common.life.deceased")
                              : t("alive")}
                          </i>
                        )}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </div>
              </section>
              <aside className="min-w-0 empty:hidden lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:row-span-2">
                <MemberFamily
                  member={currentMember}
                  layout="rows"
                  onOpenMember={(id) =>
                    setNavigation({ rootId: member.id, id })
                  }
                />
              </aside>
              <div className="min-w-0 space-y-6 lg:col-start-1">
                {currentMember.additionalData && (
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("notes")}</ItemTitle>
                      <ItemDescription className="whitespace-pre-wrap line-clamp-none">
                        {currentMember.additionalData}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )}

                {hasLocations && (
                  <Item variant="field">
                    <ItemContent>
                      <ItemTitle>{t("locations")}</ItemTitle>
                      <div className="space-y-2 mt-1">
                        {currentMember.birthplace && (
                          <Location
                            align="start"
                            label={t("birthplace")}
                            location={currentMember.birthplace}
                          />
                        )}
                        {currentMember.hometown && (
                          <Location
                            align="start"
                            label={t("hometown")}
                            location={currentMember.hometown}
                          />
                        )}
                        {currentMember.cemetery && (
                          <Location
                            align="start"
                            label={t("cemetery")}
                            location={currentMember.cemetery}
                          />
                        )}
                        {currentMember.placesLived.map((place, idx) => (
                          <Location
                            key={idx}
                            align="start"
                            location={place.location}
                            trailing={
                              (place.from || place.to) && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({place.from ?? "?"}
                                  {place.to ? ` – ${place.to}` : ""})
                                </span>
                              )
                            }
                          />
                        ))}
                      </div>
                    </ItemContent>
                  </Item>
                )}

                {memberEvents.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Calendar className="size-5" />
                        {t("life-events")} ({memberEvents.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {memberEvents.map((event) => {
                          const { icon: EventIcon } = getEventTypeInfo(
                            event.eventType,
                          );
                          return (
                            <CollapsibleEvent
                              key={event.id}
                              icon={EventIcon}
                              typeLabel={getEventTypeLabel(
                                event.eventType,
                                i18n.t,
                              )}
                              date={formatDateWithFallback(event.date, i18n.t)}
                              location={event.location}
                              description={event.description}
                              className="p-4 bg-accent/30"
                            />
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {memberStories.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <BookOpen className="size-5" />
                        {t("stories")} ({memberStories.length})
                      </h3>
                      <div className="grid grid-cols-1 gap-4">
                        {memberStories.map((story) => (
                          <CollapsibleStory
                            key={story.id}
                            title={story.title}
                            content={story.content}
                            className="p-5 bg-accent/30"
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {memberDiseases.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Activity className="size-5" />
                        {t("diseases")} ({memberDiseases.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {memberDiseases.map((disease) => (
                          <div
                            key={disease.id}
                            className="border rounded-lg p-4 bg-accent/30 hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Activity className="size-4 text-muted-foreground shrink-0" />
                              <span className="font-semibold">
                                {disease.name}
                              </span>
                              <Badge
                                variant={getStatusBadgeVariant(
                                  disease.carrierStatus,
                                )}
                              >
                                {i18n.t(
                                  `sheet.member-sheet.diseases.dialog.carrier-status-${disease.carrierStatus}`,
                                )}
                              </Badge>
                            </div>
                            {disease.inheritancePattern !== "unknown" && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {i18n.t(
                                  `sheet.member-sheet.diseases.dialog.inheritance-pattern-${disease.inheritancePattern.replace(/_/g, "-")}`,
                                )}
                              </p>
                            )}
                            {disease.diagnosisDate && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {formatDate(disease.diagnosisDate)}
                              </p>
                            )}
                            {disease.notes && (
                              <p className="text-sm mt-2">{disease.notes}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {linkedImages.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Images className="size-5" />
                        {t("images")} ({linkedImages.length})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {linkedImages.map((image, index) => (
                          <AuthenticatedImage
                            key={image.id}
                            src={image.imageData}
                            alt={image.title || t("images")}
                            className="w-full h-36 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => openLightbox(index)}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {lightboxOpen && (
        <ImageLightbox
          images={linkedImages}
          startIndex={startIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
};

/** A single introduction, with the same life summary used elsewhere in the app. */
function PersonHeader({ member }: { member: Member }) {
  const life = useMemberLife(member);
  const sourceNames =
    member.isMerged && member.sourceWorkspaceNames?.length
      ? member.sourceWorkspaceNames
      : member.sourceWorkspaceName
        ? [member.sourceWorkspaceName]
        : [];
  return (
    <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:pr-8 sm:text-left">
      <MemberAvatar member={member} size="xl" />
      <div className="min-w-0 space-y-2">
        <DialogTitle className="text-3xl leading-tight font-bold tracking-tight break-words sm:text-4xl">
          {[member.academicTitle, member.firstName, member.lastName]
            .filter(Boolean)
            .join(" ")}
        </DialogTitle>
        {life.born && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {life.born}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <Badge
            variant={life.deceased ? "muted" : "success"}
            className="max-w-full whitespace-normal text-left leading-relaxed"
          >
            {life.status}
          </Badge>
          {sourceNames.map((name) => (
            <Badge
              key={name}
              variant="outline"
              className="max-w-full whitespace-normal"
            >
              {name}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
