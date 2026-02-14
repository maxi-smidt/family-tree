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
        <DialogContent className="max-w-[95vw] w-full max-h-[95vh] h-full overflow-y-auto p-8">
          <DialogHeader>
            <DialogTitle className="text-3xl font-bold">
              {member.firstName} {member.lastName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-8">
            {/* Profile Section */}
            <div className="flex gap-8 items-start">
              <FamilyNodeContent member={member} largeImage />
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <div className="text-sm font-semibold text-muted-foreground mb-1">
                      First Name
                    </div>
                    <div className="text-lg">{member.firstName}</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-muted-foreground mb-1">
                      Last Name
                    </div>
                    <div className="text-lg">{member.lastName}</div>
                  </div>
                  {member.maidenName && (
                    <div>
                      <div className="text-sm font-semibold text-muted-foreground mb-1">
                        Maiden Name
                      </div>
                      <div className="text-lg">{member.maidenName}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-muted-foreground mb-1">
                      Gender
                    </div>
                    <div className="text-lg capitalize">
                      {member.gender === "m"
                        ? "Male"
                        : member.gender === "f"
                          ? "Female"
                          : "Other"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-muted-foreground mb-1">
                      Date of Birth
                    </div>
                    <div className="text-lg">{formatDate(member.date.birth)}</div>
                  </div>
                  {member.date.death && (
                    <div>
                      <div className="text-sm font-semibold text-muted-foreground mb-1">
                        Date of Death
                      </div>
                      <div className="text-lg">
                        {formatDate(member.date.death)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator className="my-6" />

            {/* Family Relationships */}
            <div className="space-y-5">
              <h3 className="text-2xl font-bold flex items-center gap-3">
                <Users className="w-6 h-6" />
                Family Relationships
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {paternalParent && (
                  <div className="p-4 border rounded-lg bg-accent/30">
                    <div className="text-sm font-semibold text-muted-foreground mb-2">
                      Paternal Parent
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5" />
                      <span className="text-base">
                        {paternalParent.firstName} {paternalParent.lastName}
                      </span>
                    </div>
                  </div>
                )}
                {maternalParent && (
                  <div className="p-4 border rounded-lg bg-accent/30">
                    <div className="text-sm font-semibold text-muted-foreground mb-2">
                      Maternal Parent
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5" />
                      <span className="text-base">
                        {maternalParent.firstName} {maternalParent.lastName}
                      </span>
                    </div>
                  </div>
                )}
                {children.length > 0 && (
                  <div className="p-4 border rounded-lg bg-accent/30">
                    <div className="text-sm font-semibold text-muted-foreground mb-2">
                      Children ({children.length})
                    </div>
                    <div className="space-y-2">
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
                  <div className="p-4 border rounded-lg bg-accent/30">
                    <div className="text-sm font-semibold text-muted-foreground mb-2">
                      Siblings ({siblings.length})
                    </div>
                    <div className="space-y-2">
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

            <Separator className="my-6" />

            {/* Life Events */}
            {memberEvents.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <Calendar className="w-6 h-6" />
                  Life Events ({memberEvents.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {memberEvents.map((event) => (
                    <div key={event.id} className="border rounded-lg p-5 bg-accent/30 hover:bg-accent/50 transition-colors">
                      <div className="font-semibold text-lg mb-3">
                        {event.eventType}
                      </div>
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
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
                        <p className="text-sm mt-3 text-foreground leading-relaxed">
                          {event.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {memberEvents.length > 0 && memberStories.length > 0 && <Separator className="my-6" />}

            {/* Stories */}
            {memberStories.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <BookOpen className="w-6 h-6" />
                  Stories & Biographies ({memberStories.length})
                </h3>
                <div className="grid grid-cols-1 gap-5">
                  {memberStories.map((story) => (
                    <div key={story.id} className="border rounded-lg p-6 bg-accent/30 hover:bg-accent/50 transition-colors">
                      <h4 className="font-semibold text-xl mb-4">{story.title}</h4>
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

            {/* Linked Images */}
            {linkedImages.length > 0 && (
              <div className="space-y-5">
                <h3 className="text-2xl font-bold">
                  Linked Images ({linkedImages.length})
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
