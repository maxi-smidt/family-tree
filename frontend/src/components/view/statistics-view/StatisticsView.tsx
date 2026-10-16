import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChartColumn } from "lucide-react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { StatTile } from "@/components/shared/StatTile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import type { NameCount, StatisticsReport } from "@/types/statistics";
import {
  CompletenessCard,
  DecadeChartCard,
  GenderUpcomingCard,
  LivesLivedCard,
  NamesCard,
  RankedCard,
} from "./widgets";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Names shared by at least two people — a list of ones says nothing. */
const recurring = (names: NameCount[]) =>
  names.filter((n) => n.count > 1).slice(0, 6);

const joinName = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(" ");

function KpiRow({ report, t }: { report: StatisticsReport; t: T }) {
  const total = report.total_members;
  const living = report.living_count ?? 0;
  const longest = report.longest_lives?.[0];
  const earliest = report.earliest_birth;
  const topPlace = report.top_birthplaces?.[0];
  const withLifespan = report.lifespan_distribution.reduce(
    (sum, g) => sum + g.count,
    0,
  );
  return (
    <>
      <StatTile
        className="xl:col-span-3"
        label={t("kpi-people")}
        value={total}
        note={t("kpi-people-note", { living, deceased: total - living })}
      />
      <StatTile
        className="xl:col-span-3"
        label={t("kpi-lifespan")}
        value={
          report.average_lifespan !== null
            ? Math.round(report.average_lifespan)
            : "—"
        }
        unit={
          report.average_lifespan !== null ? t("kpi-lifespan-unit") : undefined
        }
        note={
          longest
            ? t("kpi-lifespan-note", {
                count: withLifespan,
                name: longest.first_name ?? "",
                age: longest.age,
              })
            : t("kpi-lifespan-none")
        }
      />
      <StatTile
        className="xl:col-span-3"
        label={t("kpi-earliest")}
        value={earliest?.year ?? "—"}
        note={
          earliest
            ? earliest.place
              ? t("kpi-earliest-note-place", {
                  name: joinName(earliest.first_name, earliest.last_name),
                  place: earliest.place,
                })
              : joinName(earliest.first_name, earliest.last_name)
            : t("kpi-earliest-none")
        }
      />
      <StatTile
        className="xl:col-span-3"
        label={t("kpi-birthplace")}
        value={topPlace?.name ?? "—"}
        note={
          topPlace
            ? t("kpi-birthplace-note", { count: topPlace.count, total })
            : t("kpi-birthplace-none")
        }
      />
    </>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-12">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="px-5 xl:col-span-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-20" />
        </Card>
      ))}
      <Card className="h-72 px-5 md:col-span-2 xl:col-span-8">
        <Skeleton className="h-4 w-48" />
      </Card>
      <Card className="h-72 px-5 md:col-span-2 xl:col-span-4">
        <Skeleton className="h-4 w-24" />
      </Card>
    </div>
  );
}

export const StatisticsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { report, isLoading, refreshStatistics } = useStatisticsStore();
  const members = useMemberStore((s) => s.members);
  const events = useEventStore((s) => s.events);
  const eventsInitialized = useEventStore((s) => s.initialized);
  const refreshEvents = useEventStore((s) => s.refreshEvents);
  const stories = useStoryStore((s) => s.stories);
  const storiesInitialized = useStoryStore((s) => s.initialized);
  const refreshStories = useStoryStore((s) => s.refreshStories);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const setActiveView = useActiveViewStore((s) => s.setActiveView);

  useDeferredStoreLoad(eventsInitialized, refreshEvents);
  useDeferredStoreLoad(storiesInitialized, refreshStories);

  useEffect(() => {
    if (!report) {
      refreshStatistics();
    }
  }, [report, refreshStatistics]);

  const handleOpenMember = useCallback(
    (memberId: string) => {
      if (!selectedTree?.id) return;
      setOpenSheet(selectedTree.id, {
        memberId,
        tab: "identity",
        mode: "view",
      });
    },
    [selectedTree?.id, setOpenSheet],
  );

  return (
    <ViewLayout
      title={t("title")}
      subtitle={
        selectedTree ? t("subtitle", { name: selectedTree.name }) : undefined
      }
    >
      {isLoading && !report ? (
        <LoadingGrid />
      ) : !report || report.total_members === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumn />
            </EmptyMedia>
            <EmptyTitle>{t("empty-title")}</EmptyTitle>
            <EmptyDescription>{t("empty-description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5 pb-2 md:grid-cols-2 xl:grid-cols-12">
          <KpiRow report={report} t={t} />
          <DecadeChartCard
            className="md:col-span-2 xl:col-span-8"
            report={report}
            t={t}
          />
          <GenderUpcomingCard
            className="md:col-span-2 xl:col-span-4"
            report={report}
            members={members}
            events={events}
            stories={stories}
            onOpenMember={handleOpenMember}
            t={t}
          />
          <LivesLivedCard
            className="md:col-span-2 xl:col-span-6"
            report={report}
            onOpenMember={handleOpenMember}
            t={t}
          />
          <RankedCard
            className="xl:col-span-3"
            title={t("birthplaces-title")}
            description={t("birthplaces-description")}
            items={report.top_birthplaces ?? []}
          />
          <CompletenessCard
            className="xl:col-span-3"
            report={report}
            stories={stories}
            t={t}
            onReview={() => setActiveView("quality-report-view")}
          />
          <NamesCard
            className="md:col-span-2 xl:col-span-12"
            first={recurring(report.top_first_names)}
            last={recurring(report.top_last_names)}
            t={t}
          />
        </div>
      )}
    </ViewLayout>
  );
};
