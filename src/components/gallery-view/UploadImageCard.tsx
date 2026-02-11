import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";

type Props = {
  onClick: () => void;
};

export const UploadImageCard = ({ onClick }: Props) => {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer h-48 flex items-center justify-center border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary transition-colors"
    >
      <div className="flex flex-col items-center">
        <Plus className="mb-2" />
        <span>Upload Image</span>
      </div>
    </Card>
  );
};
