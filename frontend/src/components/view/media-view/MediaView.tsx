import { GalleryView } from "@/components/view/gallery-view/GalleryView";
import { DocumentsView } from "@/components/view/documents-view/DocumentsView";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";

export type MediaSection = "gallery" | "documents";

interface MediaViewProps {
  section: MediaSection;
}

export const MediaView = ({ section }: MediaViewProps) => {
  const restrictions = useWorkspaceStore(
    (state) => state.selectedTree?.restrictions ?? [],
  );
  const galleryAvailable = !restrictions.includes("gallery");
  const documentsAvailable = !restrictions.includes("sources");
  if (!galleryAvailable && !documentsAvailable) return null;

  const activeSection =
    section === "gallery" && galleryAvailable
      ? "gallery"
      : section === "documents" && documentsAvailable
        ? "documents"
        : galleryAvailable
          ? "gallery"
          : "documents";

  return activeSection === "gallery" ? <GalleryView /> : <DocumentsView />;
};
