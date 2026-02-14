import { Member } from "@/types/member";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { MemberEvents } from "./MemberEvents";
import { MemberStories } from "./MemberStories";

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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);

  const linkedImages = (galleryImages || []).filter((image) => {
    const linkedIds = Array.isArray(image.linkedMemberIds)
      ? image.linkedMemberIds
      : [];
    return linkedIds.includes(member.id);
  });

  const openLightbox = (index: number) => {
    setStartIndex(index);
    setLightboxOpen(true);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return <i>Unknown</i>;
    return format(new Date(dateString), "dd.MM.yyyy");
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
          <ItemTitle>{t("additional-info")}</ItemTitle>
          <ItemDescription>
            {member.additionalData || <i>{t("additional-info-fallback")}</i>}
          </ItemDescription>
        </ItemContent>
      </Item>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t("linked-images")}</ItemTitle>
          {linkedImages.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {linkedImages.map((image, index) => (
                <img
                  key={image.id}
                  src={image.imageData}
                  alt={image.title || "Linked image"}
                  className="w-full h-24 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => openLightbox(index)}
                />
              ))}
            </div>
          ) : (
            <ItemDescription>
              <i>{t("linked-images-fallback")}</i>
            </ItemDescription>
          )}
        </ItemContent>
      </Item>

      <MemberEvents member={member} />

      <MemberStories member={member} />

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
