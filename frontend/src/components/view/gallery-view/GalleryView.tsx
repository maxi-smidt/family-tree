import { useGalleryStore } from "@/hooks/useGalleryStore";
import { ImageCard } from "@/components/view/gallery-view/ImageCard";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
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
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { Skeleton } from "@/components/ui/skeleton";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import { UploadQueuePanel } from "@/components/view/gallery-view/UploadQueuePanel";

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
  const { galleryImages, refreshGalleryImages, initialized } =
    useGalleryStore();
  const isReady = useTreeStore((state) => state.isReady);

  useDeferredStoreLoad(initialized, refreshGalleryImages);

  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    items,
    enqueue,
    retry,
    cancel,
    clearCompleted,
    total,
    doneCount,
    isActive,
  } = useUploadQueue();

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
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same files later
    if (files.length === 0) return;
    enqueue(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) {
      enqueue(files);
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
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSortDirection}
              aria-label={
                sortDirection === "asc"
                  ? t("sort-ascending")
                  : t("sort-descending")
              }
            >
              {sortDirection === "asc" ? <ArrowUp /> : <ArrowDown />}
            </Button>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
      {isEmpty ? (
        <div
          className="relative flex-1"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10">
              <p className="text-lg font-medium text-primary">
                {t("upload-queue.dropzone")}
              </p>
            </div>
          )}
          <Empty className="h-full border">
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
        </div>
      ) : (
        <div
          className="relative flex-1"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10">
              <p className="text-lg font-medium text-primary">
                {t("upload-queue.dropzone")}
              </p>
            </div>
          )}
          <div ref={parentRef} className="h-full overflow-y-auto">
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
        </div>
      )}
      {selectedImage && (
        <ImageSheet
          isOpen={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          image={selectedImage}
        />
      )}
      <UploadQueuePanel
        items={items}
        total={total}
        doneCount={doneCount}
        isActive={isActive}
        onRetry={retry}
        onCancel={cancel}
        onClearCompleted={clearCompleted}
      />
    </ViewLayout>
  );
};
