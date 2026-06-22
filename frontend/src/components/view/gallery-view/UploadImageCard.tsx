import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onClick: () => void;
};

export const UploadImageCard = ({ onClick }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view",
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={t("upload-image-card")}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer h-full flex items-center justify-center border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary transition-colors"
    >
      <div className="flex flex-col items-center">
        <Plus className="mb-2" />
        <span>{t("upload-image-card")}</span>
      </div>
    </Card>
  );
};
