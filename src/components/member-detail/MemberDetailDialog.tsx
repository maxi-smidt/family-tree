import { Member } from "@/types/member";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useState } from "react";
import { ImageLightbox } from "@/components/sheet/ImageLightbox";
import { format } from "date-fns";
import { Calendar, MapPin, BookOpen, Users, User } from "lucide-react";
import { Separator } from "@/components/ui/separator";

type Props = {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const MemberDetailDialog = ({ member, open, onOpenChange }: Props) => {
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    return format(new Date(dateString), "PPP");
  };

  const formatEventDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "PPP");
    } catch {
      return dateStr;
    }
  };

  // Get parent members
  const paternalParent = member.parents.paternalParent
    ? members.find((m) => m.id === member.parents.paternalParent)
    : null;
  const maternalParent = member.parents.maternalParent
    ? members.find((m) => m.id === member.parents.maternalParent)
    : null;

  // Get children
  const children = members.filter(
    (m) =>
      m.parents.paternalParent === member.id ||
      m.parents.maternalParent === member.id,
  );

  // Get siblings
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {member.firstName} {member.lastName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Profile Section */}
            <div className="flex gap-6 items-start">
              <FamilyNodeContent member={member} largeImage />
              <div className="flex-1 space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      First Name
                    </div>
                    <div className="text-base">{member.firstName}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      Last Name
                    </div>
                    <div className="text-base">{member.lastName}</div>
                  </div>
                  {member.maidenName && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">
                        Maiden Name
                      </div>
                      <div className="text-base">{member.maidenName}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      Gender
                    </div>
                    <div className="text-base capitalize">
                      {member.gender === "m"
                        ? "Male"
                        : member.gender === "f"
                          ? "Female"
                          : "Other"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      Date of Birth
                    </div>
                    <div className="text-base">{formatDate(member.date.birth)}</div>
                  </div>
                  {member.date.death && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">
                        Date of Death
                      </div>
                      <div className="text-base">
                        {formatDate(member.date.death)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Family Relationships */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5" />
                Family Relationships
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paternalParent && (
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Paternal Parent
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <span>
                        {paternalParent.firstName} {paternalParent.lastName}
                      </span>
                    </div>
                  </div>
                )}
                {maternalParent && (
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Maternal Parent
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <span>
                        {maternalParent.firstName} {maternalParent.lastName}
                      </span>
                    </div>
                  </div>
                )}
                {children.length > 0 && (
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Children ({children.length})
                    </div>
                    <div className="space-y-1">
                      {children.map((child) => (
                        <div key={child.id} className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span className="text-sm">
                            {child.firstName} {child.lastName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {siblings.length > 0 && (
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Siblings ({siblings.length})
                    </div>
                    <div className="space-y-1">
                      {siblings.map((sibling) => (
                        <div key={sibling.id} className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span className="text-sm">
                            {sibling.firstName} {sibling.lastName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Life Events */}
            {memberEvents.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Life Events ({memberEvents.length})
                </h3>
                <div className="space-y-3">
                  {memberEvents.map((event) => (
                    <div key={event.id} className="border rounded-lg p-4 bg-accent/30">
                      <div className="font-medium text-base mb-2">
                        {event.eventType}
                      </div>
                      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>{formatEventDate(event.date)}</span>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span>{event.location}</span>
                          </div>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-sm mt-3 text-foreground">
                          {event.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {memberEvents.length > 0 && memberStories.length > 0 && <Separator />}

            {/* Stories */}
            {memberStories.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Stories & Biographies ({memberStories.length})
                </h3>
                <div className="space-y-4">
                  {memberStories.map((story) => (
                    <div key={story.id} className="border rounded-lg p-4 bg-accent/30">
                      <h4 className="font-medium text-base mb-3">{story.title}</h4>
                      <div className="text-sm whitespace-pre-wrap">
                        {story.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(memberStories.length > 0 || memberEvents.length > 0) &&
              linkedImages.length > 0 && <Separator />}

            {/* Linked Images */}
            {linkedImages.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">
                  Linked Images ({linkedImages.length})
                </h3>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {linkedImages.map((image, index) => (
                    <img
                      key={image.id}
                      src={image.imageData}
                      alt={image.title || "Linked image"}
                      className="w-full h-32 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
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
