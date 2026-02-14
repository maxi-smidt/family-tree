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
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { CollapsibleSection } from "./CollapsibleSection";
import { Calendar, MapPin, BookOpen } from "lucide-react";

type Props = {
  member: Member;
};

export const ViewMode = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.view-mode",
  });
  const { t: tGender } = useTranslation(undefined, {
    keyPrefix: "common.gender",
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

  const openLightbox = (index: number) => {
    setStartIndex(index);
    setLightboxOpen(true);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return <i>Unknown</i>;
    return format(new Date(dateString), "dd.MM.yyyy");
  };

  const formatEventDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "PP");
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="w-full space-y-4 overflow-y-auto">
      <FamilyNodeContent member={member} largeImage />

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
              {tGender(member.gender)}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("dob-item")}</ItemTitle>
            <ItemDescription>{formatDate(member.date.birth)}</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t("dod-item")}</ItemTitle>
            <ItemDescription>
              {member.date.death ? (
                formatDate(member.date.death)
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
          <ItemTitle>Life Events</ItemTitle>
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
                        <div className="font-medium mb-1">{event.eventType}</div>
                        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>{formatEventDate(event.date)}</span>
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
              <i>No events recorded</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>Stories & Biographies</ItemTitle>
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
              <i>No stories written yet</i>
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
