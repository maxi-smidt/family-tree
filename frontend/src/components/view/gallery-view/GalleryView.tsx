import { useGalleryStore } from "@/hooks/useGalleryStore";
import { ApiError } from "@/services/api";
import { toast } from "sonner";
import { ImageCard } from "@/components/view/gallery-view/ImageCard";
import { ChangeEvent, useMemo, useRef, useState } from "react";
import { ImageSheet } from "@/components/view/gallery-view/ImageSheet";
import { GalleryImage } from "@/types/gallery";
import { UploadImageCard } from "@/components/view/gallery-view/UploadImageCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ImagePlus, Search } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { formatDateTime } from "@/utils/dateUtils";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Skeleton } from "@/components/ui/skeleton";

type SortKey = "createdAt" | "uploadedAt" | "title";
type SortDirection = "asc" | "desc";

const SKELETON_CARDS = 10;

function GallerySkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-4 p-1">
        <Skeleton className="h-9 w-72" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <div className="grid flex-1 auto-rows-[300px] grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: SKELETON_CARDS }).map((_, index) => (
          <div
            key={index}
            className="flex h-full flex-col overflow-hidden rounded-xl border"
          >
            <Skeleton className="min-h-0 flex-1 rounded-none" />
            <div className="space-y-2 p-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const GalleryView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "gallery-view.view" });
  const { galleryImages, addGalleryImage } = useGalleryStore();
  const isReady = useTreeStore((state) => state.isReady);
  const mediaLimits = useAuthStore((state) => state.config?.media_limits);
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState("");

  const parentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: galleryImages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  const handleUploadImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64String = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          if (mediaLimits && width > height) {
            if (width > mediaLimits.stored_image_width) {
              height *= mediaLimits.stored_image_width / width;
              width = mediaLimits.stored_image_width;
            }
          } else if (mediaLimits) {
            if (height > mediaLimits.stored_image_height) {
              width *= mediaLimits.stored_image_height / height;
              height = mediaLimits.stored_image_height;
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

          addGalleryImage({
            imageData: compressedBase64,
            title: formatDateTime(new Date()),
            description: null,
            linkedMemberIds: [],
          })
            .then(() => {
              toast.success(t("toast-success-image-upload"));
            })
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 413) {
                toast.error(t("toast-error-image-too-large"));
              } else if (err instanceof ApiError && err.status === 400) {
                toast.error(t("toast-error-image-unsupported"));
              } else {
                toast.error(t("toast-error-image-upload"));
              }
            });
        };
        img.onerror = () => toast.error(t("toast-error-image-upload"));
        img.src = base64String;
      };
      reader.onerror = () => toast.error(t("toast-error-read-file"));
      reader.readAsDataURL(file);
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

  const isEmpty = galleryImages.length === 0;

  if (!isReady) {
    return (
      <ViewLayout title={t("title")}>
        <GallerySkeleton />
      </ViewLayout>
    );
  }

  return (
    <ViewLayout title={t("title")}>
      {!isEmpty && (
        <div className="flex justify-between items-center mb-4 gap-4 p-1">
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
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      {isEmpty ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImagePlus />
            </EmptyMedia>
            <EmptyTitle>{t("empty-title")}</EmptyTitle>
            <EmptyDescription>{t("empty-description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={handleUploadImage}>
              <ImagePlus />
              {t("empty-cta")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
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
      )}
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
