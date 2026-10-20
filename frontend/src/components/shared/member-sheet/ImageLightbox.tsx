import {
  X,
  ChevronLeft,
  ChevronRight,
  UserRoundSearch,
  Pencil,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/button";
import { MemberChip } from "@/components/shared/MemberChip";
import { GalleryImage, GalleryMemberLink } from "@/types/gallery";
import { ImageSheet } from "@/components/view/gallery-view/ImageSheet";
import { canEditArea } from "@/utils/accessLevels";
import "./image-lightbox.css";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTranslation } from "react-i18next";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { cn } from "@/lib/utils";

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

/** Shared photo viewer for the gallery and member panels. */
export const ImageLightbox = ({ images, startIndex, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-lightbox",
  });
  const members = useMemberStore((state) => state.members);
  const selectedTree = useWorkspaceStore((state) => state.selectedTree);
  const workspaceId = selectedTree?.id;
  const canWrite = canEditArea(selectedTree, "gallery");
  // Keep the editor's initial snapshot stable while unknown-face actions
  // update the gallery immediately, preserving unsaved metadata and links.
  const [editingImage, setEditingImage] = useState<GalleryImage | null>(null);
  const editing = editingImage !== null;
  const [currentId, setCurrentId] = useState(images[startIndex]?.id);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const currentIndex = Math.max(
    0,
    images.findIndex((image) => image.id === currentId),
  );
  const currentImage = images[currentIndex];
  const layoutRef = useRef<HTMLDivElement>(null);
  const [photoElement, setPhotoElement] = useState<HTMLDivElement | null>(null);
  const [peoplePosition, setPeoplePosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const photo = photoElement;
    if (editing || !layout || !photo) return;
    // Use only the space beyond the centered photo. If there is too little
    // room for a readable list, let it flow below instead of moving the photo.
    const measure = () => {
      const bounds = layout.getBoundingClientRect();
      const imageBounds = photo.getBoundingClientRect();
      const available = bounds.right - imageBounds.right - 24;
      const next =
        window.innerWidth >= 900 && available >= 160
          ? {
              left: imageBounds.right - bounds.left + 24,
              width: Math.min(256, available - 4),
              maxHeight: Math.max(
                0,
                Math.min(bounds.height - 8, window.innerHeight - 160),
              ),
            }
          : null;
      setPeoplePosition((current) =>
        current?.left === next?.left &&
        current?.width === next?.width &&
        current?.maxHeight === next?.maxHeight
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    observer.observe(photo);
    return () => observer.disconnect();
  }, [photoElement, currentImage?.id, editing]);

  const navigate = (direction: number) => {
    setHoveredTag(null);
    setCurrentId(
      images[(currentIndex + direction + images.length) % images.length]?.id,
    );
  };
  const memberName = (memberId: string) => {
    const member = members.find((candidate) => candidate.id === memberId);
    return member
      ? `${member.firstName} ${member.lastName}`.trim()
      : t("unknown-member");
  };
  const openMember = (memberId: string) => {
    if (!workspaceId) return;
    onClose();
    useMemberSheetStore.getState().setOpenSheet(workspaceId, {
      memberId,
      tab: "identity",
      mode: "view",
    });
  };

  if (!currentImage) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={
            !editing && currentImage.description
              ? "image-viewer-description"
              : undefined
          }
          className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto px-12 py-16 outline-none sm:px-20"
          onEscapeKeyDown={(event) => {
            if (editing) {
              event.preventDefault();
              setEditingImage(null);
            }
          }}
          onKeyDown={(event) => {
            if (
              !editing &&
              (event.key === "ArrowLeft" || event.key === "ArrowRight")
            ) {
              event.preventDefault();
              event.stopPropagation();
              navigate(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:bg-white/20"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X className="h-6 w-6" />
          </Button>
          {canWrite && !editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-16 top-4 text-white hover:bg-white/20"
              onClick={() => {
                setHoveredTag(null);
                setEditingImage(currentImage);
              }}
            >
              <Pencil />
              {t("edit")}
            </Button>
          )}
          {images.length > 1 && !editing && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 sm:left-4"
                onClick={() => navigate(-1)}
                aria-label={t("previous")}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 sm:right-4"
                onClick={() => navigate(1)}
                aria-label={t("next")}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            </>
          )}
          {editing && (
            <Dialog.Title className="sr-only">
              {currentImage.title || t("image-alt")}
            </Dialog.Title>
          )}
          <div
            ref={layoutRef}
            className={cn(
              "image-viewer-layout",
              editing && "image-viewer-layout-editing",
            )}
          >
            {editing ? (
              <ImageSheet
                key={currentImage.id}
                isOpen
                inline
                image={editingImage ?? currentImage}
                onClose={() => setEditingImage(null)}
                onOpenMember={onClose}
                onImageDeleted={onClose}
              />
            ) : (
              <>
                <div className="image-viewer-photo">
                  <div
                    ref={setPhotoElement}
                    className="relative inline-flex max-w-full shrink-0"
                  >
                    <AuthenticatedImage
                      src={currentImage.imageData}
                      alt={currentImage.title || t("image-alt")}
                      className="image-viewer-image block max-w-full rounded-md shadow-2xl"
                    />
                    {currentImage.memberLinks
                      .filter(hasFaceRegion)
                      .map((link) => {
                        const tag = `member:${link.memberId}`;
                        const member = members.find(
                          (candidate) => candidate.id === link.memberId,
                        );
                        return (
                          <button
                            key={tag}
                            type="button"
                            aria-label={t("face-tag", {
                              name: memberName(link.memberId),
                            })}
                            className={cn(
                              "absolute border-2 border-primary bg-primary/20 transition-opacity focus-visible:outline-2 focus-visible:outline-white",
                              hoveredTag === tag ? "opacity-100" : "opacity-0",
                            )}
                            style={{
                              left: `${link.x * 100}%`,
                              top: `${link.y * 100}%`,
                              width: `${link.w * 100}%`,
                              height: `${link.h * 100}%`,
                            }}
                            onMouseEnter={() => setHoveredTag(tag)}
                            onMouseLeave={() => setHoveredTag(null)}
                            onFocus={() => setHoveredTag(tag)}
                            onBlur={() => setHoveredTag(null)}
                            onClick={() => setHoveredTag(tag)}
                          >
                            <span className="pointer-events-none absolute left-0 top-0 -translate-y-full whitespace-nowrap pb-1 text-foreground">
                              {member ? (
                                <MemberChip member={member} fullName />
                              ) : (
                                memberName(link.memberId)
                              )}
                            </span>
                          </button>
                        );
                      })}
                    {currentImage.unknownFaces.map((face) => {
                      const tag = `unknown:${face.id}`;
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-label={t("unknown-face-tag")}
                          className={cn(
                            "absolute border-2 border-amber-500 bg-amber-500/20 transition-opacity",
                            hoveredTag === tag ? "opacity-100" : "opacity-0",
                          )}
                          style={{
                            left: `${face.x * 100}%`,
                            top: `${face.y * 100}%`,
                            width: `${face.w * 100}%`,
                            height: `${face.h * 100}%`,
                          }}
                          onMouseEnter={() => setHoveredTag(tag)}
                          onMouseLeave={() => setHoveredTag(null)}
                          onFocus={() => setHoveredTag(tag)}
                          onBlur={() => setHoveredTag(null)}
                          onClick={() => setHoveredTag(tag)}
                        >
                          <span className="pointer-events-none absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-xs text-white">
                            {t("unknown-person")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <Dialog.Title className="text-center text-lg font-medium text-white">
                    {currentImage.title || t("image-alt")}
                  </Dialog.Title>
                  {currentImage.description && (
                    <Dialog.Description
                      id="image-viewer-description"
                      className="max-w-2xl whitespace-pre-wrap text-center text-sm text-white/80"
                    >
                      {currentImage.description}
                    </Dialog.Description>
                  )}
                  <p className="text-sm text-white/60" aria-live="polite">
                    {currentIndex + 1} / {images.length}
                  </p>
                </div>
                {(currentImage.memberLinks.length > 0 ||
                  currentImage.unknownFaces.length > 0) && (
                  <aside
                    aria-label={t("linked-people")}
                    className={cn(
                      "image-viewer-people",
                      peoplePosition && "image-viewer-people-docked",
                    )}
                    style={peoplePosition ?? undefined}
                  >
                    {currentImage.memberLinks.map((link) => {
                      const member = members.find(
                        (candidate) => candidate.id === link.memberId,
                      );
                      const tag = `member:${link.memberId}`;
                      return (
                        <span
                          key={tag}
                          onMouseEnter={() => setHoveredTag(tag)}
                          onMouseLeave={() => setHoveredTag(null)}
                          onFocus={() => setHoveredTag(tag)}
                          onBlur={() => setHoveredTag(null)}
                        >
                          {member ? (
                            <MemberChip
                              member={member}
                              fullName
                              onOpen={workspaceId ? openMember : undefined}
                              className={
                                hoveredTag === tag
                                  ? "border-primary bg-accent text-foreground"
                                  : "text-foreground"
                              }
                            />
                          ) : (
                            <span className="text-sm text-white/80">
                              {t("unknown-member")}
                            </span>
                          )}
                        </span>
                      );
                    })}
                    {currentImage.unknownFaces.map((face) => {
                      const tag = `unknown:${face.id}`;
                      return (
                        <button
                          key={tag}
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card py-0 pl-1 pr-3 text-[13px] text-foreground hover:border-amber-500 focus-visible:ring-2 focus-visible:ring-ring"
                          onMouseEnter={() => setHoveredTag(tag)}
                          onMouseLeave={() => setHoveredTag(null)}
                          onFocus={() => setHoveredTag(tag)}
                          onBlur={() => setHoveredTag(null)}
                          onClick={() => setHoveredTag(tag)}
                        >
                          <span className="grid size-6 place-items-center rounded-full bg-muted">
                            <UserRoundSearch className="size-3.5" />
                          </span>
                          {t("unknown-person")}
                        </button>
                      );
                    })}
                  </aside>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
