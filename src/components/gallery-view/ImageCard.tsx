import { Card } from "@/components/ui/card";
import { GalleryImage } from "@/types/gallery";

type Props = {
  image: GalleryImage;
  onClick: () => void;
};

export const ImageCard = ({ image, onClick }: Props) => {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer h-48 overflow-hidden relative group"
    >
      <img
        src={image.imageData}
        alt={image.title || "Gallery Image"}
        className="w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-2 text-white">
        <h3 className="font-bold truncate">{image.title}</h3>
      </div>
    </Card>
  );
};
