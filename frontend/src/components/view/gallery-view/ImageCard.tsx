import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { GalleryImage } from "@/types/gallery";
import { formatDateWithFallback, getYear } from "@/utils/dateUtils";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { ImageIcon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemberStore } from "@/hooks/useMemberStore";
import { getMemberFullName } from "@/utils/memberUtils";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import type { Member } from "@/types/member";

// Names beyond this count collapse into a "+K more" suffix.
const MAX_VISIBLE_NAMES = 2;
const MAX_AVATARS = 3;

type Props = {
  image: GalleryImage;
  onClick: () => void;
  onEdit?: () => void;
};

/**
 * A photo tile: the picture with its year on top, then the title, the people
 * in it, and the full date. The tile opens the viewer; its pencil opens editing.
 */
export const ImageCard = ({ image, onClick, onEdit }: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "gallery-view.view",
  });
  const members = useMemberStore((state) => state.members);

  const linked = useMemo(
    () =>
      image.linkedMemberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is Member => !!member),
    [image.linkedMemberIds, members],
  );
  const linkedNames = linked.map(getMemberFullName);
  const visibleNames = linkedNames.slice(0, MAX_VISIBLE_NAMES);
  const extraCount = linkedNames.length - visibleNames.length;
  const year = getYear(image.createdAt);

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        aria-label={image.title || t("image-alt-fallback")}
        onClick={onClick}
        className="flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-muted">
          <AuthenticatedImage
            src={image.imageData}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            fallback={
              <span className="grid size-full place-items-center text-muted-foreground">
                <ImageIcon className="size-8 opacity-40" />
              </span>
            }
          />
          {year !== null && (
            <span className="absolute bottom-2.5 left-2.5 rounded-md bg-card/90 px-1.5 py-0.5 text-xs font-semibold tabular-nums shadow-xs backdrop-blur">
              {year}
            </span>
          )}
        </div>
        <div className="min-w-0 px-0.5">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {image.title || t("image-alt-fallback")}
            </h3>
            {linked.length > 0 && (
              <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                {linked.slice(0, MAX_AVATARS).map((m) => (
                  <MemberAvatar
                    key={m.id}
                    member={m}
                    size="xs"
                    className="ring-2 ring-background"
                  />
                ))}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span>{formatDateWithFallback(image.createdAt, i18n.t)}</span>
            {linkedNames.length > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span title={linkedNames.join(", ")}>
                  {visibleNames.join(", ")}
                  {extraCount > 0 &&
                    ` ${t("linked-members-more", { count: extraCount })}`}
                </span>
              </>
            )}
          </p>
        </div>
      </button>
      {onEdit && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={t("edit-image", {
            title: image.title || t("image-alt-fallback"),
          })}
          className="absolute right-2.5 top-2.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      )}
    </div>
  );
};
