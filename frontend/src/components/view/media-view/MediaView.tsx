import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GalleryView } from "@/components/view/gallery-view/GalleryView";
import { DocumentsView } from "@/components/view/documents-view/DocumentsView";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";

type MediaSection = "gallery" | "documents";

export const MediaView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "media-view" });
  const features = useAuthStore((state) => state.features);
  const restrictions = useTreeStore(
    (state) => state.selectedTree?.restrictions ?? [],
  );
  const galleryAvailable =
    features.includes("gallery") && !restrictions.includes("gallery");
  const documentsAvailable =
    features.includes("sources") && !restrictions.includes("sources");
  const defaultSection: MediaSection = galleryAvailable
    ? "gallery"
    : "documents";
  const [activeSection, setActiveSection] =
    useState<MediaSection>(defaultSection);
  const activeSectionAvailable =
    (activeSection === "gallery" && galleryAvailable) ||
    (activeSection === "documents" && documentsAvailable);

  useEffect(() => {
    if (!activeSectionAvailable) setActiveSection(defaultSection);
  }, [activeSectionAvailable, defaultSection]);

  if (!galleryAvailable && !documentsAvailable) return null;

  return (
    <Tabs
      value={activeSection}
      onValueChange={(value) => setActiveSection(value as MediaSection)}
      className="h-full min-h-0"
    >
      <TabsList className="mx-4 mt-3 flex-none">
        {galleryAvailable && (
          <TabsTrigger value="gallery">{t("gallery")}</TabsTrigger>
        )}
        {documentsAvailable && (
          <TabsTrigger value="documents">{t("documents")}</TabsTrigger>
        )}
      </TabsList>
      {galleryAvailable && (
        <TabsContent
          value="gallery"
          className="m-0 flex min-h-0 flex-1 flex-col"
        >
          <GalleryView />
        </TabsContent>
      )}
      {documentsAvailable && (
        <TabsContent
          value="documents"
          className="m-0 flex min-h-0 flex-1 flex-col"
        >
          <DocumentsView />
        </TabsContent>
      )}
    </Tabs>
  );
};
