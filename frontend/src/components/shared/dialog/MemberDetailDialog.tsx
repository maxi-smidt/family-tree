import { Member } from "@/types/member";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { FamilyNodeContent } from "@/components/view/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ImageLightbox } from "@/components/shared/member-sheet/ImageLightbox";
import { CollapsibleStory } from "@/components/shared/member-sheet/CollapsibleStory";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Calendar, BookOpen, Users, Images, Activity } from "lucide-react";
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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    if (open && member) {
      const alreadyLoaded = detailLoadedIds.has(member.id);
      if (!alreadyLoaded) {
        setIsLoadingDetail(true);
      }
      void fetchMemberDetail(member.id).finally(() =>
        setIsLoadingDetail(false),
      );
    }
  }, [open, member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defer secondary-domain stores until the dialog opens (no-op while closed).
  useDeferredStoreLoad(eventsInitialized || !open, refreshEvents);
  useDeferredStoreLoad(storiesInitialized || !open, refreshStories);
  useDeferredStoreLoad(galleryInitialized || !open, refreshGalleryImages);

  if (!member) return null;

  // Always reflect the latest store data rather than the snapshot passed as prop
  const currentMember = members.find((m) => m.id === member.id) ?? member;

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

  const paternalParent = currentMember.parents.paternalParent
    ? members.find((m) => m.id === currentMember.parents.paternalParent)
    : null;
  const maternalParent = currentMember.parents.maternalParent
    ? members.find((m) => m.id === currentMember.parents.maternalParent)
    : null;
  const children = members.filter(
    (m) =>
      m.parents.paternalParent === currentMember.id ||
      m.parents.maternalParent === currentMember.id,
  );
  const siblings = members.filter(
    (m) =>
      m.id !== currentMember.id &&
      ((currentMember.parents.paternalParent &&
        m.parents.paternalParent === currentMember.parents.paternalParent) ||
        (currentMember.parents.maternalParent &&
          m.parents.maternalParent === currentMember.parents.maternalParent)),
  );

  const hasFamilyRelations = !!(
    paternalParent ||
    maternalParent ||
    children.length > 0 ||
    siblings.length > 0
  );
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
        <DialogContent className="sm:max-w-[90%] w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              {currentMember.firstName} {currentMember.lastName}
              {isLoadingDetail && <Spinner className="size-4" />}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Avatar + core fields */}
            <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
              <div className="flex-shrink-0">
                <FamilyNodeContent
                  member={currentMember}
                  largeImage
                  disableNameLink
                />
              </div>
              <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("firstname")}</ItemTitle>
                    <ItemDescription className="text-foreground">
                      {currentMember.firstName}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("lastname")}</ItemTitle>
                    <ItemDescription className="text-foreground">
                      {currentMember.lastName}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                {currentMember.maidenName && (
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t("maiden")}</ItemTitle>
                      <ItemDescription className="text-foreground">
                        {currentMember.maidenName}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )}
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("gender")}</ItemTitle>
                    <ItemDescription className="capitalize text-foreground">
                      {i18n.t(`common.gender.${currentMember.gender}`)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("dob")}</ItemTitle>
                    <ItemDescription className="text-foreground">
                      {formatDateWithFallback(currentMember.date.birth, i18n.t)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("dod")}</ItemTitle>
                    <ItemDescription className="text-foreground">
                      {currentMember.date.death ? (
                        formatDate(currentMember.date.death)
                      ) : (
                        <i>{t("alive")}</i>
                      )}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </div>
            </div>

            {currentMember.additionalData && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("notes")}</ItemTitle>
                  <ItemDescription className="whitespace-pre-wrap line-clamp-none">
                    {currentMember.additionalData}
                  </ItemDescription>
                </ItemContent>
              </Item>
            )}

            {hasLocations && (
              <Item variant="muted">
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

            {hasFamilyRelations && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold flex items-center gap-2">
                    <Users className="size-5" />
                    {t("family-relations")}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paternalParent && (
                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t("paternal-parent")}</ItemTitle>
                          <ItemDescription className="text-foreground">
                            {paternalParent.firstName} {paternalParent.lastName}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    )}
                    {maternalParent && (
                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t("maternal-parent")}</ItemTitle>
                          <ItemDescription className="text-foreground">
                            {maternalParent.firstName} {maternalParent.lastName}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    )}
                    {children.length > 0 && (
                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>
                            {t("children")} ({children.length})
                          </ItemTitle>
                          <ItemDescription className="text-foreground">
                            {children.map((child, idx) => (
                              <span key={child.id}>
                                {child.firstName} {child.lastName}
                                {idx < children.length - 1 && ", "}
                              </span>
                            ))}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    )}
                    {siblings.length > 0 && (
                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>
                            {t("siblings")} ({siblings.length})
                          </ItemTitle>
                          <ItemDescription className="text-foreground">
                            {siblings.map((sibling, idx) => (
                              <span key={sibling.id}>
                                {sibling.firstName} {sibling.lastName}
                                {idx < siblings.length - 1 && ", "}
                              </span>
                            ))}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    )}
                  </div>
                </div>
              </>
            )}

            {memberEvents.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold flex items-center gap-2">
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
                          typeLabel={getEventTypeLabel(event.eventType, i18n.t)}
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
                  <h3 className="text-xl font-semibold flex items-center gap-2">
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
                  <h3 className="text-xl font-semibold flex items-center gap-2">
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
                          <span className="font-semibold">{disease.name}</span>
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
                  <h3 className="text-xl font-semibold flex items-center gap-2">
                    <Images className="size-5" />
                    {t("images")} ({linkedImages.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {linkedImages.map((image, index) => (
                      <AuthenticatedImage
                        key={image.id}
                        src={image.imageData}
                        alt={image.title || "Linked image"}
                        className="w-full h-36 object-cover rounded-lg cursor-pointer hover:opacity-90 hover:scale-105 transition-all shadow-sm"
                        onClick={() => openLightbox(index)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
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
