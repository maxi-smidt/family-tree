import { Member } from "@/types/member";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";
import { useTranslation } from "react-i18next";
import { CollapsibleSection } from "./CollapsibleSection";
import { Calendar, MapPin, BookOpen, Activity } from "lucide-react";
import { formatDate } from "@/utils/dateUtils";
import { Badge } from "@/components/ui/badge";

type Props = {
  member: Member;
};

export const ViewMode = ({ member }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.view-mode",
  });
  const { galleryImages } = useGalleryStore();
  const { getEventsByMember } = useEventStore();
  const { getStoriesByMember } = useStoryStore();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);

  const linkedImages = (galleryImages || []).filter((image) => {
    const linkedIds = Array.isArray(image.linkedMemberIds)
      ? image.linkedMemberIds
      : [];
    return linkedIds.includes(member.id);
  });

  const memberEvents = getEventsByMember(member.id).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const memberStories = getStoriesByMember(member.id);

  const memberDiseases = member.diseases || [];

  const openLightbox = (index: number) => {
    setStartIndex(index);
    setLightboxOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "affected":
        return "destructive";
      case "carrier":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="w-full space-y-4 overflow-y-auto">
      <div className="flex justify-center">
        <FamilyNodeContent member={member} largeImage />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("firstname-item")}</ItemTitle>
            <ItemDescription>{member.firstName}</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("lastname-item")}</ItemTitle>
            <ItemDescription>{member.lastName}</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("maiden-item")}</ItemTitle>
            <ItemDescription>
              {member.maidenName || <i>{t("maiden-fallback")}</i>}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("gender-item")}</ItemTitle>
            <ItemDescription className="capitalize">
              {i18n.t(`common.gender.${member.gender}`)}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("dob-item")}</ItemTitle>
            <ItemDescription>
              {formatDate(member.date.birth, i18n.t)}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("dod-item")}</ItemTitle>
            <ItemDescription>
              {member.date.death ? (
                formatDate(member.date.death, i18n.t)
              ) : (
                <i>{t("dod-fallback")}</i>
              )}
            </ItemDescription>
          </ItemContent>
        </Item>
      </div>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t("linked-images")}</ItemTitle>
          {linkedImages.length > 0 ? (
            <CollapsibleSection
              totalCount={linkedImages.length}
              collapsedCount={3}
            >
              {(showAll) => (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {linkedImages
                    .slice(0, showAll ? linkedImages.length : 3)
                    .map((image, index) => (
                      <img
                        key={image.id}
                        src={image.imageData}
                        alt={image.title || "Linked image"}
                        className="w-full h-24 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => openLightbox(index)}
                      />
                    ))}
                </div>
              )}
            </CollapsibleSection>
          ) : (
            <ItemDescription>
              <i>{t("linked-images-fallback")}</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t("life-events")}</ItemTitle>
          {memberEvents.length > 0 ? (
            <CollapsibleSection
              totalCount={memberEvents.length}
              collapsedCount={3}
            >
              {(showAll) => (
                <div className="space-y-3 mt-2">
                  {memberEvents
                    .slice(0, showAll ? memberEvents.length : 3)
                    .map((event) => (
                      <div
                        key={event.id}
                        className="border rounded-lg p-3 bg-accent/50"
                      >
                        <div className="font-medium mb-1">
                          {event.eventType}
                        </div>
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
                    ))}
                </div>
              )}
            </CollapsibleSection>
          ) : (
            <ItemDescription>
              <i>{t("no-events")}</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t("stories")}</ItemTitle>
          {memberStories.length > 0 ? (
            <CollapsibleSection
              totalCount={memberStories.length}
              collapsedCount={3}
            >
              {(showAll) => (
                <div className="space-y-3 mt-2">
                  {memberStories
                    .slice(0, showAll ? memberStories.length : 3)
                    .map((story) => (
                      <div
                        key={story.id}
                        className="border rounded-lg p-3 bg-accent/50"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="w-4 h-4 text-muted-foreground" />
                          <h4 className="font-medium">{story.title}</h4>
                        </div>
                        <div className="text-sm whitespace-pre-wrap line-clamp-3">
                          {story.content}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CollapsibleSection>
          ) : (
            <ItemDescription>
              <i>{t("no-stories")}</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t("genetic-conditions")}</ItemTitle>
          {memberDiseases.length > 0 ? (
            <CollapsibleSection
              totalCount={memberDiseases.length}
              collapsedCount={3}
            >
              {(showAll) => (
                <div className="space-y-3 mt-2">
                  {memberDiseases
                    .slice(0, showAll ? memberDiseases.length : 3)
                    .map((disease) => (
                      <div
                        key={disease.id}
                        className="border rounded-lg p-3 bg-accent/50"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{disease.name}</span>
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
                        <div className="flex flex-col gap-1">
                          {disease.inheritancePattern !== "unknown" && (
                            <p className="text-xs text-muted-foreground">
                              {i18n.t(
                                `sheet.member-sheet.diseases.dialog.inheritance-pattern-${disease.inheritancePattern.replace(/_/g, "-")}`,
                              )}
                            </p>
                          )}
                          {disease.diagnosisDate && (
                            <p className="text-sm text-muted-foreground">
                              {new Date(
                                disease.diagnosisDate,
                              ).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        {disease.notes && (
                          <p className="text-sm mt-2">{disease.notes}</p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </CollapsibleSection>
          ) : (
            <ItemDescription>
              <i>{t("no-conditions")}</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      {lightboxOpen && (
        <ImageLightbox
          images={linkedImages}
          startIndex={startIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};
