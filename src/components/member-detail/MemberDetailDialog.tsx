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
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useState } from "react";
import { ImageLightbox } from "@/components/member-sheet/ImageLightbox";
import { Calendar, MapPin, BookOpen, Users } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/utils/dateUtils";

type Props = {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const MemberDetailDialog = ({ member, open, onOpenChange }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "dialog.member-detail",
  });
  const { galleryImages } = useGalleryStore();
  const { getEventsByMember } = useEventStore();
  const { getStoriesByMember } = useStoryStore();
  const { members } = useMemberStore();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);

  if (!member) return null;

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

  const paternalParent = member.parents.paternalParent
    ? members.find((m) => m.id === member.parents.paternalParent)
    : null;
  const maternalParent = member.parents.maternalParent
    ? members.find((m) => m.id === member.parents.maternalParent)
    : null;

  const children = members.filter(
    (m) =>
      m.parents.paternalParent === member.id ||
      m.parents.maternalParent === member.id,
  );

  const siblings = members.filter(
    (m) =>
      m.id !== member.id &&
      ((member.parents.paternalParent &&
        m.parents.paternalParent === member.parents.paternalParent) ||
        (member.parents.maternalParent &&
          m.parents.maternalParent === member.parents.maternalParent)),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[90%] w-full max-h-[95vh] h-full overflow-y-auto p-8">
          <DialogHeader>
            <DialogTitle className="text-3xl font-bold">
              {member.firstName} {member.lastName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-8">
            <div className="flex flex-col items-center gap-6">
              <FamilyNodeContent member={member} largeImage />

              <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("firstname")}</ItemTitle>
                    <ItemDescription>{member.firstName}</ItemDescription>
                  </ItemContent>
                </Item>

                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("lastname")}</ItemTitle>
                    <ItemDescription>{member.lastName}</ItemDescription>
                  </ItemContent>
                </Item>

                {member.maidenName && (
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t("maiden")}</ItemTitle>
                      <ItemDescription>{member.maidenName}</ItemDescription>
                    </ItemContent>
                  </Item>
                )}

                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("gender")}</ItemTitle>
                    <ItemDescription className="capitalize">
                      {i18n.t(`common.gender.${member.gender}`)}
                    </ItemDescription>
                  </ItemContent>
                </Item>

                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("dob")}</ItemTitle>
                    <ItemDescription>
                      {formatDate(member.date.birth, i18n.t)}
                    </ItemDescription>
                  </ItemContent>
                </Item>

                {member.date.death && (
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>t("dod")</ItemTitle>
                      <ItemDescription>
                        {formatDate(member.date.death, i18n.t)}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )}
              </div>
            </div>

            <Separator className="my-6" />

            <div className="space-y-5">
              <h3 className="text-2xl font-bold flex items-center gap-3">
                <Users />
                {t("family-relations")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paternalParent && (
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t("paternal-parent")}</ItemTitle>
                      <ItemDescription>
                        {paternalParent.firstName} {paternalParent.lastName}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )}
                {maternalParent && (
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t("maternal-parent")}</ItemTitle>
                      <ItemDescription>
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
                      <ItemDescription>
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
                      <ItemDescription>
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

            <Separator className="my-6" />

            {memberEvents.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <Calendar />
                  {t("life-events")} ({memberEvents.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {memberEvents.map((event) => (
                    <div
                      key={event.id}
                      className="border rounded-lg p-5 bg-accent/30 hover:bg-accent/50 transition-colors"
                    >
                      <div className="font-semibold text-lg mb-3">
                        {event.eventType}
                      </div>
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar />
                          <span>{formatDate(event.date, t)}</span>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-2">
                            <MapPin />
                            <span>{event.location}</span>
                          </div>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-sm mt-3 text-foreground leading-relaxed">
                          {event.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {memberEvents.length > 0 && memberStories.length > 0 && (
              <Separator className="my-6" />
            )}

            {memberStories.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <BookOpen />
                  {t("stories")} ({memberStories.length})
                </h3>
                <div className="grid grid-cols-1 gap-5">
                  {memberStories.map((story) => (
                    <div
                      key={story.id}
                      className="border rounded-lg p-6 bg-accent/30 hover:bg-accent/50 transition-colors"
                    >
                      <h4 className="font-semibold text-xl mb-4">
                        {story.title}
                      </h4>
                      <div className="text-base whitespace-pre-wrap leading-relaxed">
                        {story.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(memberStories.length > 0 || memberEvents.length > 0) &&
              linkedImages.length > 0 && <Separator className="my-6" />}

            {linkedImages.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold">
                  {t("images")} ({linkedImages.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {linkedImages.map((image, index) => (
                    <img
                      key={image.id}
                      src={image.imageData}
                      alt={image.title || "Linked image"}
                      className="w-full h-40 object-cover rounded-lg cursor-pointer hover:opacity-90 hover:scale-105 transition-all shadow-md"
                      onClick={() => openLightbox(index)}
                    />
                  ))}
                </div>
              </div>
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
