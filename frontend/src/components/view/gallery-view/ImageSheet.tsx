import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GalleryImage, GalleryMemberLink } from "@/types/gallery";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { useTranslation } from "react-i18next";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useTreeStore } from "@/hooks/useTreeStore";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  image: GalleryImage;
};

interface FaceRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_REGION_SIZE = 0.02;

function hasFaceRegion(
  link: GalleryMemberLink,
): link is GalleryMemberLink & FaceRegion {
  return (
    link.x !== null && link.y !== null && link.w !== null && link.h !== null
  );
}

function regionFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): FaceRegion {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export const ImageSheet = ({ isOpen, onClose, image }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-sheet",
  });
  const { members } = useMemberStore();
  const { updateGalleryImage, deleteGalleryImage } = useGalleryStore();
  const treeRole = useTreeStore((state) => state.selectedTree?.role);
  const canWrite = treeRole !== "viewer";
  const [formData, setFormData] = useState<Partial<GalleryImage>>(image);
  const [tagMode, setTagMode] = useState(false);
  const [draftRegion, setDraftRegion] = useState<FaceRegion | null>(null);
  const [draftMemberId, setDraftMemberId] = useState<string | null>(null);
  const [newMemberId, setNewMemberId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const drawingStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setFormData(image);
    setTagMode(false);
    setDraftRegion(null);
    setDraftMemberId(null);
    setNewMemberId(null);
    setEditingMemberId(null);
    setHoveredMemberId(null);
  }, [image]);

  const memberLinks = formData.memberLinks ?? image.memberLinks;
  const editingTag = memberLinks.find(
    (link) => link.memberId === editingMemberId && hasFaceRegion(link),
  );

  const memberName = (memberId: string) => {
    const member = members.find((candidate) => candidate.id === memberId);
    return member
      ? `${member.firstName} ${member.lastName}`.trim()
      : t("unknown-member");
  };

  const setMemberLinks = (nextLinks: GalleryMemberLink[]) => {
    setFormData((current) => ({
      ...current,
      memberLinks: nextLinks,
      linkedMemberIds: nextLinks.map((link) => link.memberId),
    }));
  };

  const handleSave = () => {
    updateGalleryImage(image.id, formData)
      .then(() => {
        toast.success(t("toast-success"));
        onClose();
      })
      .catch(() => toast.error(t("toast-error")));
  };

  const handleDelete = () => {
    deleteGalleryImage(image.id)
      .then(() => {
        toast.success(t("toast-delete-success"));
        onClose();
      })
      .catch(() => toast.error(t("toast-delete-error")));
  };

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData({ ...formData, createdAt: date.toISOString() });
    }
  };

  const updatePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const handleTagPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!tagMode || !canWrite || event.button !== 0) return;
    const point = updatePoint(event);
    drawingStart.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftRegion({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const handleTagPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawingStart.current) return;
    event.preventDefault();
    setDraftRegion(regionFromPoints(drawingStart.current, updatePoint(event)));
  };

  const handleTagPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drawingStart.current;
    if (!start) return;
    const region = regionFromPoints(start, updatePoint(event));
    drawingStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (region.w < MIN_REGION_SIZE || region.h < MIN_REGION_SIZE) {
      setDraftRegion(null);
      return;
    }

    if (editingTag) {
      setMemberLinks(
        memberLinks.map((link) =>
          link.memberId === editingTag.memberId ? { ...link, ...region } : link,
        ),
      );
      setEditingMemberId(null);
      setDraftRegion(null);
      return;
    }

    setDraftRegion(region);
    setDraftMemberId(null);
  };

  const handleAddFaceTag = () => {
    if (!draftRegion || !draftMemberId) return;
    setMemberLinks([
      ...memberLinks.filter((link) => link.memberId !== draftMemberId),
      { memberId: draftMemberId, ...draftRegion },
    ]);
    setHoveredMemberId(draftMemberId);
    setDraftRegion(null);
    setDraftMemberId(null);
  };

  const handleAddWholeImageLink = () => {
    if (!newMemberId) {
      return;
    }
    if (memberLinks.some((link) => link.memberId === newMemberId)) {
      toast.info(
        t("toast-member-already-linked", { name: memberName(newMemberId) }),
      );
      return;
    }
    setMemberLinks([
      ...memberLinks,
      { memberId: newMemberId, x: null, y: null, w: null, h: null },
    ]);
    setNewMemberId(null);
  };

  const handleEditTag = (memberId: string) => {
    setTagMode(true);
    setEditingMemberId(memberId);
    setDraftRegion(null);
    setDraftMemberId(null);
  };

  const handleReassignTag = (memberId: string | null) => {
    if (!memberId || !editingTag) return;
    setMemberLinks([
      ...memberLinks.filter(
        (link) =>
          link.memberId !== editingTag.memberId && link.memberId !== memberId,
      ),
      { ...editingTag, memberId },
    ]);
    setEditingMemberId(memberId);
  };

  const handleRemoveLink = (memberId: string) => {
    setMemberLinks(memberLinks.filter((link) => link.memberId !== memberId));
    if (editingMemberId === memberId) setEditingMemberId(null);
    if (hoveredMemberId === memberId) setHoveredMemberId(null);
  };

  const toggleTagMode = () => {
    setTagMode((enabled) => {
      if (enabled) {
        setDraftRegion(null);
        setDraftMemberId(null);
        setEditingMemberId(null);
      }
      return !enabled;
    });
  };

  const linkedMembers = useMemo(
    () =>
      memberLinks.map((link) => ({ link, name: memberName(link.memberId) })),
    [memberLinks, members], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-[80vw] flex flex-col p-4">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-hidden min-h-0">
          <div className="flex items-center justify-center min-h-0 overflow-hidden">
            <div className="relative inline-flex max-h-full max-w-full">
              <AuthenticatedImage
                src={image.imageData}
                alt={image.title || t("image-alt")}
                className="block max-h-full max-w-full object-contain rounded-md"
              />
              <div
                className={
                  tagMode && canWrite
                    ? "absolute inset-0 touch-none cursor-crosshair"
                    : "absolute inset-0"
                }
                onPointerDown={handleTagPointerDown}
                onPointerMove={handleTagPointerMove}
                onPointerUp={handleTagPointerUp}
              >
                {memberLinks.filter(hasFaceRegion).map((link) => {
                  const isHighlighted =
                    hoveredMemberId === link.memberId ||
                    editingMemberId === link.memberId;
                  return (
                    <Tooltip key={link.memberId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("face-tag-aria", {
                            name: memberName(link.memberId),
                          })}
                          className={
                            isHighlighted
                              ? "absolute border-2 border-primary bg-primary/25 transition-colors"
                              : "absolute border-2 border-primary/70 bg-primary/10 transition-colors"
                          }
                          style={{
                            left: `${link.x * 100}%`,
                            top: `${link.y * 100}%`,
                            width: `${link.w * 100}%`,
                            height: `${link.h * 100}%`,
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onMouseEnter={() => setHoveredMemberId(link.memberId)}
                          onMouseLeave={() => setHoveredMemberId(null)}
                          onClick={() =>
                            canWrite && handleEditTag(link.memberId)
                          }
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {memberName(link.memberId)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {draftRegion && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/15"
                    style={{
                      left: `${draftRegion.x * 100}%`,
                      top: `${draftRegion.y * 100}%`,
                      width: `${draftRegion.w * 100}%`,
                      height: `${draftRegion.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <FieldGroup className="gap-4 flex-1 overflow-y-auto px-1">
              <Field>
                <FieldLabel>{t("title-field")}</FieldLabel>
                <Input
                  placeholder={t("title-placeholder")}
                  value={formData.title || ""}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setFormData({ ...formData, title: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("description-field")}</FieldLabel>
                <Textarea
                  placeholder={t("description-placeholder")}
                  value={formData.description || ""}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      description: event.target.value,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("date-field")}</FieldLabel>
                <DatePicker
                  value={new Date(formData.createdAt || new Date())}
                  onChange={canWrite ? handleDateChange : undefined}
                />
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>{t("members-field")}</FieldLabel>
                  {canWrite && (
                    <Button
                      type="button"
                      size="sm"
                      variant={tagMode ? "secondary" : "outline"}
                      onClick={toggleTagMode}
                    >
                      {tagMode ? <X /> : <Tag />}
                      {tagMode ? t("tag-mode-done") : t("tag-mode")}
                    </Button>
                  )}
                </div>
                <div className="space-y-1 rounded-md border p-2">
                  {linkedMembers.length === 0 ? (
                    <p className="px-1 py-1 text-sm text-muted-foreground">
                      {t("members-empty")}
                    </p>
                  ) : (
                    linkedMembers.map(({ link, name }) => (
                      <div
                        key={link.memberId}
                        className={
                          hoveredMemberId === link.memberId
                            ? "flex items-center gap-2 rounded-sm bg-primary/10 px-1 py-1"
                            : "flex items-center gap-2 rounded-sm px-1 py-1"
                        }
                        onMouseEnter={() => setHoveredMemberId(link.memberId)}
                        onMouseLeave={() => setHoveredMemberId(null)}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                          onClick={() =>
                            hasFaceRegion(link) &&
                            canWrite &&
                            handleEditTag(link.memberId)
                          }
                        >
                          {name}
                        </button>
                        <span className="text-xs text-muted-foreground">
                          {hasFaceRegion(link)
                            ? t("face-tag")
                            : t("whole-image-link")}
                        </span>
                        {canWrite && (
                          <>
                            {hasFaceRegion(link) && (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t("edit-face-tag", { name })}
                                onClick={() => handleEditTag(link.memberId)}
                              >
                                <Pencil />
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t("remove-member", { name })}
                              onClick={() => handleRemoveLink(link.memberId)}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {canWrite && !tagMode && (
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <MemberPicker
                        members={members}
                        value={newMemberId}
                        onChange={setNewMemberId}
                        placeholder={t("members-placeholder")}
                        noResultsText={t("members-no-results")}
                        size="default"
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      disabled={!newMemberId}
                      aria-label={t("add-member")}
                      onClick={handleAddWholeImageLink}
                    >
                      <Plus />
                    </Button>
                  </div>
                )}
              </Field>
              {tagMode && canWrite && (
                <Field className="rounded-md border border-dashed p-3">
                  <FieldLabel>{t("face-tags-title")}</FieldLabel>
                  <p className="text-sm text-muted-foreground">
                    {editingTag
                      ? t("face-tags-replace-hint", {
                          name: memberName(editingTag.memberId),
                        })
                      : draftRegion
                        ? t("face-tags-assign-hint")
                        : t("face-tags-draw-hint")}
                  </p>
                  {editingTag ? (
                    <>
                      <MemberPicker
                        members={members}
                        value={editingTag.memberId}
                        onChange={handleReassignTag}
                        placeholder={t("members-placeholder")}
                        noResultsText={t("members-no-results")}
                        size="default"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingMemberId(null)}
                      >
                        {t("cancel-tag-edit")}
                      </Button>
                    </>
                  ) : (
                    draftRegion && (
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <MemberPicker
                            members={members}
                            value={draftMemberId}
                            onChange={setDraftMemberId}
                            placeholder={t("face-tags-member-placeholder")}
                            noResultsText={t("members-no-results")}
                            size="default"
                          />
                        </div>
                        <Button
                          type="button"
                          disabled={!draftMemberId}
                          onClick={handleAddFaceTag}
                        >
                          {t("add-face-tag")}
                        </Button>
                      </div>
                    )
                  )}
                </Field>
              )}
            </FieldGroup>
            {canWrite && (
              <div className="flex justify-end gap-2 mt-4 shrink-0">
                <Button onClick={handleSave}>{t("save")}</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">{t("delete")}</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("delete-confirm-title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("delete-confirm-description")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("delete-confirm-cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={handleDelete}
                      >
                        {t("delete-confirm-confirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
