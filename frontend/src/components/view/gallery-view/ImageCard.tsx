import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { GalleryImage } from "@/types/gallery";
import { formatDateWithFallback } from "@/utils/dateUtils";
import { useTranslation } from "react-i18next";
import { KeyboardEvent, useMemo } from "react";
import { Users } from "lucide-react";
import { useMemberStore } from "@/hooks/useMemberStore";
import { getMemberFullName } from "@/utils/memberUtils";

// Names beyond this count collapse into a "+K more" suffix.
const MAX_VISIBLE_NAMES = 2;

type Props = {
  image: GalleryImage;
  onClick: () => void;
};

export const ImageCard = ({ image, onClick }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "gallery-view.view",
  });
  const members = useMemberStore((state) => state.members);

  const linkedNames = useMemo(
    () =>
      image.linkedMemberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member) => !!member)
        .map(getMemberFullName),
    [image.linkedMemberIds, members],
  );

  const visibleNames = linkedNames.slice(0, MAX_VISIBLE_NAMES);
  const extraCount = linkedNames.length - visibleNames.length;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={image.title || t("image-alt-fallback")}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer overflow-hidden relative group flex flex-col h-full"
    >
      <CardHeader className="p-0 bg-muted/20 flex-1 min-h-0">
        <div className="overflow-hidden h-full w-full">
          <AuthenticatedImage
            src={image.imageData}
            alt=""
            className="w-full h-full object-cover pointer-events-none group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      </CardHeader>
      <CardContent className="p-2 pb-1 shrink-0">
        <h3 className="font-semibold truncate text-xs leading-tight">
          {image.title}
        </h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {formatDateWithFallback(image.createdAt, i18n.t)}
        </p>
        <p
          className={`flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 truncate ${
            linkedNames.length === 0 ? "invisible" : ""
          }`}
          title={linkedNames.length > 0 ? linkedNames.join(", ") : undefined}
        >
          <Users className="size-2.5 shrink-0" />
          <span className="truncate">
            {visibleNames.join(", ")}
            {extraCount > 0 &&
              ` ${t("linked-members-more", { count: extraCount })}`}
          </span>
        </p>
      </CardContent>
    </Card>
  );
};
