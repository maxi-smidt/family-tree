import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onClick: () => void;
};

export const UploadImageCard = ({ onClick }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view",
  });

  return (
    <Card
      onClick={onClick}
      className="cursor-pointer h-48 flex items-center justify-center border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary transition-colors"
    >
      <div className="flex flex-col items-center">
        <Plus className="mb-2" />
        <span>{t("upload-image-card")}</span>
      </div>
    </Card>
  );
};
