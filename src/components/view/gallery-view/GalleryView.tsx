import { useGalleryStore } from "@/hooks/useGalleryStore";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { ImageCard } from "@/components/view/gallery-view/ImageCard";
import { useMemo, useRef, useState } from "react";
import { ImageSheet } from "@/components/view/gallery-view/ImageSheet";
import { GalleryImage } from "@/types/gallery";
import { UploadImageCard } from "@/components/view/gallery-view/UploadImageCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import {
  STORED_IMAGE_HEIGHT as MAX_HEIGHT,
  STORED_IMAGE_WIDTH as MAX_WIDTH,
} from "@/constants";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ViewLayout } from "@/components/layout/ViewLayout";

type SortKey = "createdAt" | "uploadedAt" | "title";
type SortDirection = "asc" | "desc";

export const GalleryView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "gallery-view.view" });
  const { galleryImages, addGalleryImage } = useGalleryStore();
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState("");

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: galleryImages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  const handleUploadImage = async () => {
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"],
        },
      ],
    });

    if (!filePath) return;

    try {
      const fileBytes = await readFile(filePath);
      const blob = new Blob([fileBytes]);
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64String = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            toast.error(t("toast-error-canvas-context"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.8);

          void addGalleryImage({
            imageData: compressedBase64,
            title: format(new Date(), "dd.MM.yyyy HH:mm:ss"),
            description: null,
            linkedMemberIds: [],
          });
          toast.success(t("toast-success-image-upload"));
        };
        img.onerror = () => toast.error(t("toast-error-image-upload"));
        img.src = base64String;
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      toast.error(t("toast-error-read-file"));
    }
  };

  const filteredAndSortedImages = useMemo(() => {
    const filtered = searchTerm
      ? galleryImages.filter(
          (image) =>
            (image.title &&
              image.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (image.description &&
              image.description
                .toLowerCase()
                .includes(searchTerm.toLowerCase())),
        )
      : galleryImages;

    return [...filtered].sort((a, b) => {
      const aValue = a[sortKey] || "";
      const bValue = b[sortKey] || "";

      if (sortKey === "createdAt" || sortKey === "uploadedAt") {
        return sortDirection === "asc"
          ? new Date(aValue).getTime() - new Date(bValue).getTime()
          : new Date(bValue).getTime() - new Date(aValue).getTime();
      }

      return sortDirection === "asc"
        ? (aValue as string).localeCompare(bValue as string)
        : (bValue as string).localeCompare(aValue as string);
    });
  }, [galleryImages, sortKey, sortDirection, searchTerm]);

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === "asc" ? "desc" : "asc");
  };

  return (
    <ViewLayout title={t("title")}>
      <div className="flex justify-between items-center mb-4 gap-4">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("search-placeholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={sortKey}
            onValueChange={(value) => setSortKey(value as SortKey)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("sort-placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uploadedAt">
                {t("select-date-uploaded")}
              </SelectItem>
              <SelectItem value="createdAt">
                {t("select-date-taken")}
              </SelectItem>
              <SelectItem value="title">{t("select-title")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={toggleSortDirection}>
            {sortDirection === "asc" ? <ArrowUp /> : <ArrowDown />}
          </Button>
        </div>
      </div>
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 auto-rows-[300px]">
          <UploadImageCard onClick={handleUploadImage} />
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const image = filteredAndSortedImages[virtualItem.index];
            return (
              <ImageCard
                key={image.id}
                image={image}
                onClick={() => setSelectedImage(image)}
              />
            );
          })}
        </div>
      </div>
      {selectedImage && (
        <ImageSheet
          isOpen={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          image={selectedImage}
        />
      )}
    </ViewLayout>
  );
};
