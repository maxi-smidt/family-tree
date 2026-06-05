import { GitMerge } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTranslation } from "react-i18next";

/**
 * Tree merging was tightly coupled to the old local SQLite engine. It will be
 * reimplemented as a server-side operation in a follow-up; until then the tab
 * shows an informational placeholder.
 */
export const DatabaseMergeView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "merge-view.view" });

  return (
    <ViewLayout title={t("title")}>
      <Empty className="w-full h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitMerge />
          </EmptyMedia>
          <EmptyTitle>{t("unavailable-title")}</EmptyTitle>
          <EmptyDescription>{t("unavailable-description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ViewLayout>
  );
};
