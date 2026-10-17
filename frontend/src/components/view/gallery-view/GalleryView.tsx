import { useGalleryStore } from "@/hooks/useGalleryStore";
import { ImageCard } from "@/components/view/gallery-view/ImageCard";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { ImageSheet } from "@/components/view/gallery-view/ImageSheet";
import { GalleryImage } from "@/types/gallery";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Upload,
  UserRoundPlus,
} from "lucide-react";
import { SearchInput } from "@/components/shared/SearchInput";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
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
import { comparePartialDates } from "@/utils/dateUtils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { Skeleton } from "@/components/ui/skeleton";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import { UploadQueuePanel } from "@/components/view/gallery-view/UploadQueuePanel";

type SortKey = "createdAt" | "uploadedAt" | "title";
type SortDirection = "asc" | "desc";

const SKELETON_CARDS = 8;
const GRID =
  "grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

function GallerySkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className={GRID}>
        {Array.from({ length: SKELETON_CARDS }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="aspect-[4/3] rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
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
  const isReady = useWorkspaceStore((state) => state.isReady);

  useDeferredStoreLoad(initialized, refreshGalleryImages);

  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [show, setShow] = useState<"all" | "unlinked">("all");
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

  const unlinkedCount = useMemo(
    () => galleryImages.filter((i) => i.linkedMemberIds.length === 0).length,
    [galleryImages],
  );

  const filteredAndSortedImages = useMemo(() => {
    const pool =
      show === "unlinked"
        ? galleryImages.filter((i) => i.linkedMemberIds.length === 0)
        : galleryImages;
    const filtered = searchTerm
      ? pool.filter(
          (image) =>
            (image.title &&
              image.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (image.description &&
              image.description
                .toLowerCase()
                .includes(searchTerm.toLowerCase())),
        )
      : pool;

    return [...filtered].sort((a, b) => {
      if (sortKey === "createdAt") {
        // Partial/possibly-null dates — comparePartialDates sorts undated
        // images consistently to one end instead of `new Date(null)` NaNs.
        return sortDirection === "asc"
          ? comparePartialDates(a.createdAt, b.createdAt)
          : comparePartialDates(b.createdAt, a.createdAt);
      }

      if (sortKey === "uploadedAt") {
        return sortDirection === "asc"
          ? new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
          : new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      }

      const aValue = a.title || "";
      const bValue = b.title || "";
      return sortDirection === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    });
  }, [galleryImages, sortKey, sortDirection, searchTerm, show]);

  const rowVirtualizer = useVirtualizer({
    // The virtualized indexes address the filtered list, not the complete
    // gallery. Otherwise a search result can be shorter than this count and
    // yield an undefined image at render time.
    count: filteredAndSortedImages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === "asc" ? "desc" : "asc");
  };

  const isEmpty = galleryImages.length === 0;

  const uploadButton = (
    <Button onClick={handleUploadImage}>
      <Upload />
      {t("upload-photos")}
    </Button>
  );

  if (!isReady) {
    return (
      <ViewLayout title={t("title")}>
        <GallerySkeleton />
      </ViewLayout>
    );
  }

  const dropOverlay = isDragOver && (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10">
      <p className="text-lg font-medium text-primary">
        {t("upload-queue.dropzone")}
      </p>
    </div>
  );

  return (
    <ViewLayout
      title={t("title")}
      subtitle={
        isEmpty ? undefined : t("subtitle", { count: galleryImages.length })
      }
      action={isEmpty ? undefined : uploadButton}
      toolbar={
        isEmpty ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="chip"
              size="sm"
              spacing={2}
              value={show}
              onValueChange={(v) => v && setShow(v as "all" | "unlinked")}
              aria-label={t("show-filter")}
            >
              <ToggleGroupItem value="all">
                {t("chip-all")}
                <span className="tabular-nums opacity-60">
                  {galleryImages.length}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="unlinked">
                {t("chip-unlinked")}
                <span className="tabular-nums opacity-60">{unlinkedCount}</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <SearchInput
              size="sm"
              containerClassName="w-full sm:w-60"
              placeholder={t("search-placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClear={() => setSearchTerm("")}
            />
            <div className="hidden flex-1 sm:block" />
            <Select
              value={sortKey}
              onValueChange={(value) => setSortKey(value as SortKey)}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("sort-placeholder")} />
              </SelectTrigger>
              <SelectContent align="end">
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
              variant="outline"
              size="icon-sm"
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
        )
      }
    >
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
          className="relative flex min-h-0 flex-1"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dropOverlay}
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
        </div>
      ) : (
        <div
          className="relative flex min-h-0 flex-1"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dropOverlay}
          <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
            {show === "all" && unlinkedCount > 0 && (
              <Alert variant="warning" className="mb-5">
                <UserRoundPlus />
                <AlertDescription>
                  {t("unlinked-callout", { count: unlinkedCount })}
                </AlertDescription>
                <AlertAction>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShow("unlinked")}
                  >
                    {t("unlinked-show")}
                  </Button>
                </AlertAction>
              </Alert>
            )}
            <div className={GRID}>
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
              <button
                type="button"
                onClick={handleUploadImage}
                className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Upload className="size-5" />
                {t("drop-photos")}
              </button>
            </div>
            {filteredAndSortedImages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("no-matches")}
              </p>
            )}
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
