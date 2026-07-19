import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/button";
import { GalleryImage, GalleryMemberLink } from "@/types/gallery";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTranslation } from "react-i18next";

type Props = {
  images: GalleryImage[];
  startIndex: number;
  onClose: () => void;
};

function hasFaceRegion(link: GalleryMemberLink): link is GalleryMemberLink & {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return (
    link.x !== null && link.y !== null && link.w !== null && link.h !== null
  );
}

export const ImageLightbox = ({ images, startIndex, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-lightbox",
  });
  const { members } = useMemberStore();
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex]);

  const showPrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const showNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  const currentImage = images[currentIndex];
  const memberName = (memberId: string) => {
    const member = members.find((candidate) => candidate.id === memberId);
    return member
      ? `${member.firstName} ${member.lastName}`.trim()
      : t("unknown-member");
  };
  const linkedPeople = currentImage.memberLinks
    .map((link) => memberName(link.memberId))
    .concat(currentImage.unknownFaces.length > 0 ? [t("unknown-person")] : []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/20"
        onClick={onClose}
        aria-label={t("close")}
      >
        <X className="h-6 w-6" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
        onClick={showPrev}
        aria-label={t("previous")}
      >
        <ChevronLeft className="h-8 w-8" />
      </Button>

      <div className="flex max-h-screen max-w-4xl flex-col items-center p-4">
        <div className="relative">
          <AuthenticatedImage
            src={currentImage.imageData}
            alt={currentImage.title || t("image-alt")}
            className="max-h-[80vh] max-w-full rounded-md object-contain shadow-2xl"
          />
          <div className="pointer-events-none absolute inset-0">
            {currentImage.memberLinks.filter(hasFaceRegion).map((link) => (
              <div
                key={link.memberId}
                aria-label={t("face-tag", { name: memberName(link.memberId) })}
                className="absolute border-2 border-primary bg-primary/20"
                style={{
                  left: `${link.x * 100}%`,
                  top: `${link.y * 100}%`,
                  width: `${link.w * 100}%`,
                  height: `${link.h * 100}%`,
                }}
              >
                <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-xs text-white">
                  {memberName(link.memberId)}
                </span>
              </div>
            ))}
            {currentImage.unknownFaces.map((face) => (
              <div
                key={face.id}
                aria-label={t("unknown-face-tag")}
                className="absolute border-2 border-amber-500 bg-amber-500/20"
                style={{
                  left: `${face.x * 100}%`,
                  top: `${face.y * 100}%`,
                  width: `${face.w * 100}%`,
                  height: `${face.h * 100}%`,
                }}
              >
                <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-xs text-white">
                  {t("unknown-person")}
                </span>
              </div>
            ))}
          </div>
        </div>
        {currentImage.title && (
          <p className="mt-4 text-white text-lg font-medium">
            {currentImage.title}
          </p>
        )}
        {linkedPeople.length > 0 && (
          <p className="mt-2 text-center text-sm text-white/80">
            <span className="font-medium">{t("linked-people")}:</span>{" "}
            {linkedPeople.join(", ")}
          </p>
        )}
        <p className="text-white/60 text-sm mt-2">
          {currentIndex + 1} / {images.length}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
        onClick={showNext}
        aria-label={t("next")}
      >
        <ChevronRight className="h-8 w-8" />
      </Button>
    </div>
  );
};
