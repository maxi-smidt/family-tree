import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { GalleryImage } from "@/types/gallery";
import { formatDate } from "@/utils/dateUtils";

type Props = {
  image: GalleryImage;
  onClick: () => void;
};

export const ImageCard = ({ image, onClick }: Props) => {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer overflow-hidden relative group flex flex-col h-full"
    >
      <CardHeader className="p-0 bg-muted/20 flex-1 min-h-0">
        <div className="overflow-hidden h-full w-full">
          <AuthenticatedImage
            src={image.imageData}
            alt={image.title || "Gallery Image"}
            className="w-full h-full object-cover pointer-events-none group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      </CardHeader>
      <CardContent className="p-2 pb-1 shrink-0">
        <h3 className="font-semibold truncate text-xs leading-tight">
          {image.title}
        </h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {formatDate(image.createdAt)}
        </p>
      </CardContent>
    </Card>
  );
};
