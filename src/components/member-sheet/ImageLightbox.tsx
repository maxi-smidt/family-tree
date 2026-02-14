import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GalleryImage } from "@/types/gallery";

type Props = {
  images: GalleryImage[];
  startIndex: number;
  onClose: () => void;
};

export const ImageLightbox = ({ images, startIndex, onClose }: Props) => {
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex]);

  const showPrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const showNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  const currentImage = images[currentIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
        onClick={showPrev}
      >
        <ChevronLeft className="h-8 w-8" />
      </Button>

      <div className="flex flex-col items-center max-w-4xl max-h-screen p-4">
        <img
          src={currentImage.imageData}
          alt={currentImage.title || "Gallery image"}
          className="max-w-full max-h-[80vh] object-contain rounded-md shadow-2xl"
        />
        {currentImage.title && (
          <p className="mt-4 text-white text-lg font-medium">
            {currentImage.title}
          </p>
        )}
        <p className="text-white/60 text-sm mt-2">
          {currentIndex + 1} / {images.length}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20"
        onClick={showNext}
      >
        <ChevronRight className="h-8 w-8" />
      </Button>
    </div>
  );
};
