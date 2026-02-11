import { Member } from "@/types/member";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";

type Props = {
  member: Member;
};

export const ViewMode = ({ member }: Props) => {
  const { galleryImages } = useFamilyStore();
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

  return (
    <div className="w-full">
      <FamilyNodeContent member={member} largeImage />
      <Item variant="muted" className="mt-2">
        <ItemContent>
          <ItemTitle>Additional Information</ItemTitle>
          <ItemDescription>
            {member.additionalData || <i>No information added yet.</i>}
          </ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted" className="mt-2">
        <ItemContent>
          <ItemTitle>Linked Images</ItemTitle>
          {linkedImages.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {linkedImages.map((image, index) => (
                <img
                  key={image.id}
                  src={image.imageData}
                  alt={image.title || "Linked image"}
                  className="w-full h-24 object-cover rounded-md cursor-pointer"
                  onClick={() => openLightbox(index)}
                />
              ))}
            </div>
          ) : (
            <ItemDescription>
              <i>No images linked to this person yet.</i>
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
