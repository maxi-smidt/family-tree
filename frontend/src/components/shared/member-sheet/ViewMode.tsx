import { Member, isDeceased } from "@/types/member";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { FamilyNodeContent } from "@/components/view/tree-view/node/FamilyNodeContent";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useFeature } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";
import { LinkedDocumentList } from "./LinkedDocumentList";
import { DocumentFileList } from "./DocumentFiles";
import { useTranslation } from "react-i18next";
import { CollapsibleSection } from "./CollapsibleSection";
import { CollapsibleEvent } from "./CollapsibleEvent";
import { Activity, FileText } from "lucide-react";
import { CollapsibleStory } from "./CollapsibleStory";
import { Location } from "@/components/shared/Location";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { formatDate, formatDateWithFallback } from "@/utils/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemberSheetTab } from "@/utils/memberSheetState";

type Props = {
  member: Member;
  onShowLocationOnMap?: (location: string, memberId: string) => void;
  activeTab: MemberSheetTab;
  onTabChange: (tab: MemberSheetTab) => void;
};

export const ViewMode = ({
  member,
  onShowLocationOnMap,
  activeTab,
  onTabChange,
}: Props) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.view-mode",
  });
  const { galleryImages } = useGalleryStore();
  const { getEventsByMember } = useEventStore();
  const { getStoriesByMember } = useStoryStore();
  const restrictions = useTreeStore((s) => s.selectedTree?.restrictions ?? []);
  const galleryEnabled =
    useFeature("gallery") && !restrictions.includes("gallery");
  const eventsEnabled =
    useFeature("events") && !restrictions.includes("events");
  const storiesEnabled =
    useFeature("stories") && !restrictions.includes("stories");
  const documentsEnabled =
    useFeature("sources") && !restrictions.includes("sources");
  const diseasesEnabled = !restrictions.includes("diseases");
  const mapEnabled = !restrictions.includes("map");
  const biographyEnabled = !restrictions.includes("biography");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);

  const linkedImages = (galleryImages || []).filter((image) => {
    const linkedIds = Array.isArray(image.linkedMemberIds)
      ? image.linkedMemberIds
      : [];
    return linkedIds.includes(member.id);
  });

  const { getDocumentsForMember } = useDocumentStore();

  const memberEvents = getEventsByMember(member.id).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const memberStories = getStoriesByMember(member.id);
  const memberDocuments = getDocumentsForMember(member.id);

  const memberDiseases = member.diseases || [];

  const openLightbox = (index: number) => {
    setStartIndex(index);
    setLightboxOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "affected":
        return "destructive";
      case "carrier":
        return "secondary";
      default:
        return "outline";
    }
  };

  const hasLifeContent =
    member.additionalData ||
    member.birthplace ||
    member.hometown ||
    member.cemetery ||
    member.placesLived.length > 0;
  const visibleTab =
    activeTab === "relations" || (activeTab === "life" && !hasLifeContent)
      ? "identity"
      : activeTab;

  return (
    <div className="w-full">
      <div className="flex justify-center mb-4">
        <FamilyNodeContent member={member} largeImage />
      </div>

      <Tabs
        value={visibleTab}
        onValueChange={(tab) => onTabChange(tab as MemberSheetTab)}
      >
        <TabsList variant="line" className="w-full justify-start mb-3">
          <TabsTrigger value="identity">{t("tab-identity")}</TabsTrigger>
          {hasLifeContent && (
            <TabsTrigger value="life">{t("tab-life")}</TabsTrigger>
          )}
          <TabsTrigger value="records">{t("tab-records")}</TabsTrigger>
        </TabsList>

        {/* Identity tab */}
        <TabsContent value="identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {member.academicTitle && (
              <Item variant="muted" className="sm:col-span-2">
                <ItemContent>
                  <ItemTitle>{t("academic-title-item")}</ItemTitle>
                  <ItemDescription>{member.academicTitle}</ItemDescription>
                </ItemContent>
              </Item>
            )}
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
                <ItemTitle>{t("middle-names-item")}</ItemTitle>
                <ItemDescription>
                  {member.middleNames || <i>{t("name-fallback")}</i>}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t("maiden-item")}</ItemTitle>
                <ItemDescription>
                  {member.maidenName || <i>{t("name-fallback")}</i>}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t("baptismal-name-item")}</ItemTitle>
                <ItemDescription>
                  {member.baptismalName || <i>{t("name-fallback")}</i>}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t("gender-item")}</ItemTitle>
                <ItemDescription className="capitalize">
                  {i18n.t(`common.gender.${member.gender}`)}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t("dob-item")}</ItemTitle>
                <ItemDescription>
                  {formatDateWithFallback(member.date.birth, i18n.t)}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t("dod-item")}</ItemTitle>
                <ItemDescription>
                  {member.date.death ? (
                    formatDate(member.date.death)
                  ) : isDeceased(member) ? (
                    <i>{t("dod-deceased-no-date")}</i>
                  ) : (
                    <i>{t("dod-fallback")}</i>
                  )}
                </ItemDescription>
              </ItemContent>
            </Item>
          </div>
        </TabsContent>

        {/* Life tab — only shown when there's content */}
        {hasLifeContent && (
          <TabsContent value="life">
            <div className="space-y-3">
              {biographyEnabled && member.additionalData && (
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("notes-item")}</ItemTitle>
                    <div className="text-muted-foreground text-sm font-normal">
                      <MarkdownContent content={member.additionalData} />
                    </div>
                  </ItemContent>
                </Item>
              )}

              {(member.birthplace ||
                (mapEnabled && member.hometown) ||
                (mapEnabled && member.cemetery) ||
                (mapEnabled && member.placesLived.length > 0)) && (
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t("locations-section")}</ItemTitle>
                    <div className="space-y-2 mt-1">
                      {member.birthplace && (
                        <Location
                          align="start"
                          label={t("birthplace-label")}
                          location={member.birthplace}
                          onShowOnMap={
                            mapEnabled && onShowLocationOnMap
                              ? () =>
                                  onShowLocationOnMap(
                                    member.birthplace!,
                                    member.id,
                                  )
                              : undefined
                          }
                        />
                      )}
                      {mapEnabled && member.hometown && (
                        <Location
                          align="start"
                          label={t("hometown-label")}
                          location={member.hometown}
                          onShowOnMap={
                            onShowLocationOnMap
                              ? () =>
                                  onShowLocationOnMap(
                                    member.hometown!,
                                    member.id,
                                  )
                              : undefined
                          }
                        />
                      )}
                      {mapEnabled && member.cemetery && (
                        <Location
                          align="start"
                          label={t("cemetery-label")}
                          location={member.cemetery}
                          onShowOnMap={
                            onShowLocationOnMap
                              ? () =>
                                  onShowLocationOnMap(
                                    member.cemetery!,
                                    member.id,
                                  )
                              : undefined
                          }
                        />
                      )}
                      {mapEnabled &&
                        member.placesLived.map((place, idx) => (
                          <Location
                            key={idx}
                            align="start"
                            location={place.location}
                            trailing={
                              (place.from || place.to) && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({place.from || "?"}
                                  {place.to ? ` – ${place.to}` : ""})
                                </span>
                              )
                            }
                            onShowOnMap={
                              onShowLocationOnMap && place.location
                                ? () =>
                                    onShowLocationOnMap(
                                      place.location,
                                      member.id,
                                    )
                                : undefined
                            }
                          />
                        ))}
                    </div>
                  </ItemContent>
                </Item>
              )}
            </div>
          </TabsContent>
        )}

        {/* Records tab */}
        <TabsContent value="records">
          <div className="space-y-3">
            {galleryEnabled && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("linked-images")}</ItemTitle>
                  {linkedImages.length > 0 ? (
                    <CollapsibleSection
                      totalCount={linkedImages.length}
                      collapsedCount={3}
                    >
                      {(showAll) => (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                          {linkedImages
                            .slice(0, showAll ? linkedImages.length : 3)
                            .map((image, index) => (
                              <AuthenticatedImage
                                key={image.id}
                                src={image.imageData}
                                alt={image.title || "Linked image"}
                                className="w-full h-24 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => openLightbox(index)}
                              />
                            ))}
                        </div>
                      )}
                    </CollapsibleSection>
                  ) : (
                    <ItemDescription>
                      <i>{t("linked-images-fallback")}</i>
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )}

            {eventsEnabled && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("life-events")}</ItemTitle>
                  {memberEvents.length > 0 ? (
                    <CollapsibleSection
                      totalCount={memberEvents.length}
                      collapsedCount={3}
                    >
                      {(showAll) => (
                        <div className="space-y-3 mt-2">
                          {memberEvents
                            .slice(0, showAll ? memberEvents.length : 3)
                            .map((event) => {
                              const { icon: Icon } = getEventTypeInfo(
                                event.eventType,
                              );
                              return (
                                <CollapsibleEvent
                                  key={event.id}
                                  icon={Icon}
                                  typeLabel={getEventTypeLabel(
                                    event.eventType,
                                    i18n.t,
                                  )}
                                  date={formatDateWithFallback(
                                    event.date,
                                    i18n.t,
                                  )}
                                  location={event.location}
                                  description={event.description}
                                  className="bg-accent/50"
                                >
                                  <LinkedDocumentList
                                    documentIds={event.documentIds}
                                  />
                                </CollapsibleEvent>
                              );
                            })}
                        </div>
                      )}
                    </CollapsibleSection>
                  ) : (
                    <ItemDescription>
                      <i>{t("no-events")}</i>
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )}

            {storiesEnabled && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("stories")}</ItemTitle>
                  {memberStories.length > 0 ? (
                    <CollapsibleSection
                      totalCount={memberStories.length}
                      collapsedCount={3}
                    >
                      {(showAll) => (
                        <div className="space-y-3 mt-2">
                          {memberStories
                            .slice(0, showAll ? memberStories.length : 3)
                            .map((story) => (
                              <CollapsibleStory
                                key={story.id}
                                title={story.title}
                                date={
                                  story.date
                                    ? formatDateWithFallback(story.date, i18n.t)
                                    : undefined
                                }
                                content={story.content}
                                className="bg-accent/50"
                              >
                                <LinkedDocumentList
                                  documentIds={story.documentIds}
                                />
                              </CollapsibleStory>
                            ))}
                        </div>
                      )}
                    </CollapsibleSection>
                  ) : (
                    <ItemDescription>
                      <i>{t("no-stories")}</i>
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )}

            {documentsEnabled && memberDocuments.length > 0 && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("documents")}</ItemTitle>
                  <CollapsibleSection
                    totalCount={memberDocuments.length}
                    collapsedCount={3}
                  >
                    {(showAll) => (
                      <div className="space-y-2 mt-2">
                        {memberDocuments
                          .slice(0, showAll ? memberDocuments.length : 3)
                          .map((doc) => (
                            <div
                              key={doc.id}
                              className="border rounded-lg p-3 bg-accent/50"
                            >
                              <div className="flex items-start gap-2">
                                <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">
                                    {doc.title}
                                  </p>
                                  {doc.documentDate && (
                                    <p className="text-xs text-muted-foreground">
                                      {formatDate(doc.documentDate)}
                                    </p>
                                  )}
                                  {doc.description && (
                                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                                      {doc.description}
                                    </p>
                                  )}
                                  <DocumentFileList files={doc.files} />
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </CollapsibleSection>
                </ItemContent>
              </Item>
            )}

            {diseasesEnabled && (
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t("genetic-conditions")}</ItemTitle>
                  {memberDiseases.length > 0 ? (
                    <CollapsibleSection
                      totalCount={memberDiseases.length}
                      collapsedCount={3}
                    >
                      {(showAll) => (
                        <div className="space-y-3 mt-2">
                          {memberDiseases
                            .slice(0, showAll ? memberDiseases.length : 3)
                            .map((disease) => (
                              <div
                                key={disease.id}
                                className="border rounded-lg p-3 bg-accent/50"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Activity className="w-4 h-4 text-muted-foreground" />
                                  <span className="font-medium">
                                    {disease.name}
                                  </span>
                                  <Badge
                                    variant={getStatusBadgeVariant(
                                      disease.carrierStatus,
                                    )}
                                  >
                                    {i18n.t(
                                      `sheet.member-sheet.diseases.dialog.carrier-status-${disease.carrierStatus}`,
                                    )}
                                  </Badge>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {disease.inheritancePattern !== "unknown" && (
                                    <p className="text-xs text-muted-foreground">
                                      {i18n.t(
                                        `sheet.member-sheet.diseases.dialog.inheritance-pattern-${disease.inheritancePattern.replace(/_/g, "-")}`,
                                      )}
                                    </p>
                                  )}
                                  {disease.diagnosisDate && (
                                    <p className="text-sm text-muted-foreground">
                                      {formatDate(disease.diagnosisDate)}
                                    </p>
                                  )}
                                </div>
                                {disease.notes && (
                                  <p className="text-sm mt-2">
                                    {disease.notes}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </CollapsibleSection>
                  ) : (
                    <ItemDescription>
                      <i>{t("no-conditions")}</i>
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )}
          </div>
        </TabsContent>
      </Tabs>

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
