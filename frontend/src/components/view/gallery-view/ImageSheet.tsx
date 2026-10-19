import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { canEditArea } from "@/utils/accessLevels";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GalleryImage, GalleryMemberLink } from "@/types/gallery";
import { useMemberStore } from "@/hooks/useMemberStore";
import { getMemberFullName } from "@/utils/memberUtils";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { useTranslation } from "react-i18next";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { MemberChip } from "@/components/shared/MemberChip";
import { cn } from "@/lib/utils";
import "./image-sheet.css";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Tag, Trash2, UserRoundSearch, X } from "lucide-react";
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
  initialTagMode?: boolean;
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

export const ImageSheet = ({
  isOpen,
  onClose,
  image,
  initialTagMode = false,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-sheet",
  });
  const { members } = useMemberStore();
  const {
    galleryImages,
    updateGalleryImage,
    deleteGalleryImage,
    addUnknownFace,
    updateUnknownFace,
    resolveUnknownFace,
    removeUnknownFace,
  } = useGalleryStore();
  // Unknown-face operations persist immediately (unlike member links, which
  // batch into formData until Save), so they must read the live store state
  // rather than the possibly-stale `image` prop snapshot a caller may be
  // holding onto for the sheet's lifetime.
  const unknownFaces =
    galleryImages.find((candidate) => candidate.id === image.id)
      ?.unknownFaces ?? image.unknownFaces;
  const selectedTree = useWorkspaceStore((state) => state.selectedTree);
  const canWrite = canEditArea(selectedTree, "gallery");
  const researchTasksEnabled = !selectedTree?.restrictions?.includes("tasks");
  const [formData, setFormData] = useState<Partial<GalleryImage>>(image);
  const [tagMode, setTagMode] = useState(false);
  const [draftRegion, setDraftRegion] = useState<FaceRegion | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingFaceId, setEditingFaceId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [resolvingFaceId, setResolvingFaceId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [faceOperationPending, setFaceOperationPending] = useState(false);
  const drawingStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setFormData(image);
    setTagMode(initialTagMode);
    setDraftRegion(null);
    setEditingMemberId(null);
    setEditingFaceId(null);
    setHoveredMemberId(null);
    setHoveredFaceId(null);
    setResolvingFaceId(null);
  }, [image, initialTagMode]);

  const memberLinks = formData.memberLinks ?? image.memberLinks;
  const editingTag = memberLinks.find(
    (link) => link.memberId === editingMemberId && hasFaceRegion(link),
  );
  const unlinkedMembers = useMemo(
    () =>
      members.filter(
        (member) => !memberLinks.some((link) => link.memberId === member.id),
      ),
    [memberLinks, members],
  );
  const faceCandidates = members.filter(
    (member) =>
      !memberLinks.some(
        (link) => link.memberId === member.id && hasFaceRegion(link),
      ),
  );
  const hasChanges =
    formData.title !== image.title ||
    formData.description !== image.description ||
    formData.createdAt !== image.createdAt ||
    JSON.stringify(memberLinks) !== JSON.stringify(image.memberLinks);

  const memberName = (memberId: string) => {
    const member = members.find((candidate) => candidate.id === memberId);
    return member ? getMemberFullName(member) : t("unknown-member");
  };

  const setMemberLinks = (nextLinks: GalleryMemberLink[]) => {
    setFormData((current) => ({
      ...current,
      memberLinks: nextLinks,
      linkedMemberIds: nextLinks.map((link) => link.memberId),
    }));
  };

  const saveChanges = async () => {
    setIsSaving(true);
    try {
      await updateGalleryImage(image.id, formData);
      toast.success(t("toast-success"));
      return true;
    } catch {
      toast.error(t("toast-error"));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (await saveChanges()) onClose();
  };

  const handleOpenMember = async (memberId: string) => {
    if (!selectedTree || isSaving || faceOperationPending) return;
    // Opening a profile switches views. Keep any links/metadata edited in
    // this sheet before leaving, and stay here if that save fails.
    if (canWrite && hasChanges && !(await saveChanges())) return;
    onClose();
    useMemberSheetStore.getState().setOpenSheet(selectedTree.id, {
      memberId,
      tab: "identity",
      mode: "view",
    });
  };

  const handleDelete = () => {
    deleteGalleryImage(image.id)
      .then(() => {
        toast.success(t("toast-delete-success"));
        onClose();
      })
      .catch(() => toast.error(t("toast-delete-error")));
  };

  const updatePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const handleTagPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !tagMode ||
      !canWrite ||
      isSaving ||
      faceOperationPending ||
      event.button !== 0
    )
      return;
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

    if (editingFaceId) {
      const faceId = editingFaceId;
      setFaceOperationPending(true);
      updateUnknownFace(faceId, region)
        .then(() => {
          setEditingFaceId(null);
          setDraftRegion(null);
        })
        .catch(() => toast.error(t("unknown-face-update-error")))
        .finally(() => setFaceOperationPending(false));
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
  };

  const handleAddFaceTag = (memberId: string | null) => {
    if (!draftRegion || !memberId || faceOperationPending || isSaving) return;
    setMemberLinks([
      ...memberLinks.filter((link) => link.memberId !== memberId),
      { memberId, ...draftRegion },
    ]);
    setHoveredMemberId(memberId);
    setDraftRegion(null);
  };

  const handleAddWholeImageLink = (memberId: string | null) => {
    if (!memberId) {
      return;
    }
    if (memberLinks.some((link) => link.memberId === memberId)) {
      toast.info(
        t("toast-member-already-linked", { name: memberName(memberId) }),
      );
      return;
    }
    setMemberLinks([
      ...memberLinks,
      { memberId, x: null, y: null, w: null, h: null },
    ]);
  };

  const handleEditTag = (memberId: string) => {
    if (faceOperationPending || isSaving) return;
    setTagMode(true);
    setEditingMemberId(memberId);
    setEditingFaceId(null);
    setDraftRegion(null);
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
        setEditingMemberId(null);
        setEditingFaceId(null);
      }
      return !enabled;
    });
  };

  const handleMarkUnknown = async () => {
    if (!draftRegion || faceOperationPending || isSaving) return;
    const title = t("unknown-face-task-title", {
      // Prefer the possibly-edited (unsaved) title over the prop snapshot so
      // the task references what the user currently sees.
      title: formData.title || image.title || t("image-alt"),
    });
    setFaceOperationPending(true);
    try {
      await addUnknownFace(image.id, draftRegion, {
        title,
        notes: t("unknown-face-task-notes"),
      });
      toast.success(t("unknown-face-add-success"));
      setDraftRegion(null);
    } catch {
      toast.error(t("unknown-face-add-error"));
    } finally {
      setFaceOperationPending(false);
    }
  };

  const handleEditFace = (faceId: string) => {
    if (faceOperationPending || isSaving) return;
    setTagMode(true);
    setEditingFaceId(faceId);
    setEditingMemberId(null);
    setDraftRegion(null);
  };

  const handleDeleteFace = (faceId: string) => {
    setFaceOperationPending(true);
    removeUnknownFace(faceId)
      .then(() => toast.success(t("unknown-face-delete-success")))
      .catch(() => toast.error(t("unknown-face-delete-error")))
      .finally(() => setFaceOperationPending(false));
    if (editingFaceId === faceId) setEditingFaceId(null);
    if (hoveredFaceId === faceId) setHoveredFaceId(null);
    if (resolvingFaceId === faceId) {
      setResolvingFaceId(null);
    }
  };

  const handleResolveFace = (faceId: string, memberId: string | null) => {
    if (!memberId || faceOperationPending || isSaving) return;
    setFaceOperationPending(true);
    const face = unknownFaces.find((candidate) => candidate.id === faceId);
    resolveUnknownFace(faceId, memberId)
      .then(() => {
        toast.success(t("unknown-face-resolve-success"));
        setResolvingFaceId(null);
        // Save full-replaces the image's member links from formData, so the
        // link the backend just created must be mirrored into the local
        // snapshot or a later Save would silently delete it again.
        if (!face) return;
        setFormData((current) => {
          const base = current.memberLinks ?? image.memberLinks;
          const nextLinks = [
            ...base.filter((link) => link.memberId !== memberId),
            { memberId, x: face.x, y: face.y, w: face.w, h: face.h },
          ];
          return {
            ...current,
            memberLinks: nextLinks,
            linkedMemberIds: nextLinks.map((link) => link.memberId),
          };
        });
      })
      .catch(() => toast.error(t("unknown-face-resolve-error")))
      .finally(() => setFaceOperationPending(false));
  };

  const linkedMembers = useMemo(
    () =>
      memberLinks.map((link) => ({
        link,
        name: memberName(link.memberId),
        member: members.find((candidate) => candidate.id === link.memberId),
      })),
    [memberLinks, members], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="image-editor w-full sm:max-w-[92vw] xl:max-w-[85vw] flex flex-col p-4 md:p-6">
        <SheetHeader className="shrink-0 p-0 pr-6 pb-2">
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="image-editor-body">
          <div className="image-editor-preview flex min-w-0 items-center justify-center rounded-xl bg-muted/40 p-3">
            <div className="relative inline-flex max-h-full max-w-full">
              <AuthenticatedImage
                src={image.imageData}
                alt={image.title || t("image-alt")}
                className="image-editor-image block max-w-full rounded-md"
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
                onPointerCancel={() => {
                  drawingStart.current = null;
                  setDraftRegion(null);
                }}
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
                          disabled={
                            isSaving ||
                            faceOperationPending ||
                            !members.some(
                              (member) => member.id === link.memberId,
                            )
                          }
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
                            tagMode && canWrite
                              ? handleEditTag(link.memberId)
                              : void handleOpenMember(link.memberId)
                          }
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {memberName(link.memberId)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {unknownFaces.map((face) => {
                  const isHighlighted =
                    hoveredFaceId === face.id || editingFaceId === face.id;
                  return (
                    <Tooltip key={face.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("unknown-face-aria")}
                          className={
                            isHighlighted
                              ? "absolute border-2 border-amber-500 bg-amber-500/25 transition-colors"
                              : "absolute border-2 border-amber-500/70 bg-amber-500/15 transition-colors"
                          }
                          style={{
                            left: `${face.x * 100}%`,
                            top: `${face.y * 100}%`,
                            width: `${face.w * 100}%`,
                            height: `${face.h * 100}%`,
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onMouseEnter={() => setHoveredFaceId(face.id)}
                          onMouseLeave={() => setHoveredFaceId(null)}
                          onClick={() => canWrite && handleEditFace(face.id)}
                        />
                      </TooltipTrigger>
                      <TooltipContent>{t("unknown-person")}</TooltipContent>
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
          <fieldset
            className="image-editor-form flex min-w-0 flex-col"
            disabled={isSaving || faceOperationPending}
          >
            <FieldGroup className="image-editor-fields gap-4 px-1">
              <div className="grid shrink-0 gap-4">
                <Field>
                  <FieldLabel htmlFor="image-editor-title">
                    {t("title-field")}
                  </FieldLabel>
                  <Input
                    id="image-editor-title"
                    placeholder={t("title-placeholder")}
                    value={formData.title || ""}
                    disabled={!canWrite}
                    onChange={(event) =>
                      setFormData({ ...formData, title: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="image-editor-description">
                    {t("description-field")}
                  </FieldLabel>
                  <Textarea
                    id="image-editor-description"
                    rows={2}
                    className="max-h-32 resize-none overflow-y-auto"
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
                  <PartialDatePicker
                    value={formData.createdAt}
                    onChange={(value) =>
                      setFormData({ ...formData, createdAt: value })
                    }
                    disabled={!canWrite}
                  />
                </Field>
              </div>
              <Field className="image-editor-people gap-3">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <h3
                    id="image-editor-people-heading"
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    {t("members-field")}{" "}
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
                      {linkedMembers.length + unknownFaces.length}
                    </span>
                  </h3>
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
                <div
                  role="region"
                  aria-labelledby="image-editor-people-heading"
                  tabIndex={0}
                  className="image-editor-people-list space-y-1 rounded-xl border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {linkedMembers.length === 0 && unknownFaces.length === 0 ? (
                    <p className="px-1 py-1 text-sm text-muted-foreground">
                      {t("members-empty")}
                    </p>
                  ) : (
                    <>
                      {linkedMembers.map(({ link, name, member }) => (
                        <div
                          key={link.memberId}
                          className={cn(
                            "flex flex-wrap items-center gap-2 rounded-lg p-1.5 transition-colors",
                            (hoveredMemberId === link.memberId ||
                              editingMemberId === link.memberId) &&
                              "bg-primary-soft",
                          )}
                          onMouseEnter={() => setHoveredMemberId(link.memberId)}
                          onMouseLeave={() => setHoveredMemberId(null)}
                          onFocus={() => setHoveredMemberId(link.memberId)}
                          onBlur={(event) => {
                            if (
                              !event.currentTarget.contains(event.relatedTarget)
                            )
                              setHoveredMemberId(null);
                          }}
                        >
                          <div className="min-w-0 flex-1 basis-40 space-y-1.5">
                            {member ? (
                              <MemberChip
                                member={member}
                                fullName
                                onOpen={handleOpenMember}
                                title={
                                  hasChanges
                                    ? t("save-and-open-member", { name })
                                    : undefined
                                }
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {name}
                              </span>
                            )}
                            <span className="block pl-1 text-xs text-muted-foreground">
                              {hasFaceRegion(link)
                                ? t("face-tag")
                                : t("whole-image-link")}
                            </span>
                          </div>
                          {canWrite && (
                            <div className="ml-auto flex shrink-0 items-center gap-1">
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
                            </div>
                          )}
                        </div>
                      ))}
                      {unknownFaces.map((face) => (
                        <div
                          key={face.id}
                          className={
                            hoveredFaceId === face.id
                              ? "flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 p-1.5"
                              : "flex flex-wrap items-center gap-2 rounded-lg p-1.5"
                          }
                          onMouseEnter={() => setHoveredFaceId(face.id)}
                          onMouseLeave={() => setHoveredFaceId(null)}
                        >
                          <div className="min-w-0 flex-1 basis-40 space-y-1.5">
                            <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-card py-0 pr-3 pl-1 text-[13px]">
                              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                                <UserRoundSearch className="size-3.5" />
                              </span>
                              <span className="truncate font-medium">
                                {t("unknown-person")}
                              </span>
                            </span>
                            <span className="block pl-1 text-xs text-muted-foreground">
                              {t("face-tag")}
                            </span>
                          </div>
                          {canWrite && (
                            <>
                              {resolvingFaceId === face.id ? (
                                <>
                                  <div className="w-36">
                                    <MemberPicker
                                      members={faceCandidates}
                                      value={null}
                                      onChange={(memberId) =>
                                        handleResolveFace(face.id, memberId)
                                      }
                                      autoOpen
                                      placeholder={t("resolve-placeholder")}
                                      noResultsText={t("members-no-results")}
                                      size="sm"
                                    />
                                  </div>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={t("resolve-unknown-face")}
                                  disabled={faceOperationPending || isSaving}
                                  onClick={() => {
                                    setResolvingFaceId(face.id);
                                  }}
                                >
                                  <UserRoundSearch />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t("redraw-unknown-face")}
                                onClick={() => handleEditFace(face.id)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t("delete-unknown-face")}
                                onClick={() => handleDeleteFace(face.id)}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {canWrite && !tagMode && (
                  <div className="flex shrink-0 items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <MemberPicker
                        members={unlinkedMembers}
                        value={null}
                        onChange={handleAddWholeImageLink}
                        placeholder={t("members-placeholder")}
                        noResultsText={t("members-no-results")}
                        size="default"
                      />
                    </div>
                  </div>
                )}
              </Field>
              {tagMode && canWrite && (
                <Field className="shrink-0 rounded-xl border border-dashed p-3">
                  <FieldLabel>{t("face-tags-title")}</FieldLabel>
                  <p className="text-sm text-muted-foreground">
                    {editingFaceId
                      ? t("unknown-face-replace-hint")
                      : editingTag
                        ? t("face-tags-replace-hint", {
                            name: memberName(editingTag.memberId),
                          })
                        : draftRegion
                          ? t("face-tags-assign-hint")
                          : t("face-tags-draw-hint")}
                  </p>
                  {editingFaceId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingFaceId(null)}
                    >
                      {t("cancel-tag-edit")}
                    </Button>
                  ) : editingTag ? (
                    <>
                      <MemberPicker
                        members={members.filter(
                          (member) =>
                            member.id === editingTag.memberId ||
                            !memberLinks.some(
                              (link) =>
                                link.memberId === member.id &&
                                hasFaceRegion(link),
                            ),
                        )}
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
                    draftRegion &&
                    !drawingStart.current && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-end gap-2">
                          <div className="min-w-0 flex-1">
                            <MemberPicker
                              members={faceCandidates}
                              value={null}
                              onChange={handleAddFaceTag}
                              autoOpen
                              placeholder={t("face-tags-member-placeholder")}
                              noResultsText={t("members-no-results")}
                              size="default"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setDraftRegion(null)}
                          >
                            {t("cancel-tag-edit")}
                          </Button>
                        </div>
                        {researchTasksEnabled && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleMarkUnknown}
                              disabled={faceOperationPending}
                            >
                              <UserRoundSearch />
                              {t("mark-unknown-person")}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              {t("unknown-face-persist-hint")}
                            </p>
                          </>
                        )}
                      </div>
                    )
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("face-tags-save-hint")}
                  </p>
                </Field>
              )}
            </FieldGroup>
            {canWrite && (
              <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || faceOperationPending}
                >
                  {t("save")}
                </Button>
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
          </fieldset>
        </div>
      </SheetContent>
    </Sheet>
  );
};
