import { useActivityStore } from "@/hooks/useActivityStore";
import { Activity } from "@/types/activity";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";
import { Clock, Activity as ActivityIcon } from "lucide-react";

const ACTION_KEY: Record<string, string> = {
  create: "action-create",
  update: "action-update",
  delete: "action-delete",
};

const TARGET_KEY: Record<string, string> = {
  member: "target-member",
  relation: "target-relation",
  event: "target-event",
  story: "target-story",
  gallery_image: "target-gallery_image",
  disease: "target-disease",
};

function ActivityItem({ item }: { item: Activity }) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "activity-view",
  });

  const actor = item.actorUsername ?? t("unknown-actor");
  const action = t(ACTION_KEY[item.action] ?? "action-update");
  const targetType = t(TARGET_KEY[item.targetType] ?? item.targetType);
  const label = item.targetLabel ? `"${item.targetLabel}"` : "";

  return (
    <Card className="p-4 flex gap-4 items-start">
      <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
        <ActivityIcon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-muted-foreground">{action}</span>{" "}
          <span className="text-muted-foreground">{targetType}</span>
          {label && (
            <>
              {" "}
              <span className="font-medium truncate">{label}</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDateWithFallback(item.createdAt, i18n.t)}
        </p>
      </div>
    </Card>
  );
}

export const ActivityView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "activity-view" });
  const { activities } = useActivityStore();

  return (
    <ViewLayout title={t("title")}>
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
          <ActivityIcon className="w-10 h-10 text-muted-foreground opacity-40" />
          <div>
            <p className="font-medium">{t("empty-title")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("empty-description")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          {activities.map((item) => (
            <ActivityItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </ViewLayout>
  );
};
