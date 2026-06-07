import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onAddFirstMember: () => void;
};

export const EmptyTreeState = ({ onAddFirstMember }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.empty-state",
  });

  return (
    <Empty className="border-none max-w-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Users />
        </EmptyMedia>
        <EmptyTitle>{t("title")}</EmptyTitle>
        <EmptyDescription>{t("description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onAddFirstMember}>{t("cta")}</Button>
      </EmptyContent>
    </Empty>
  );
};
