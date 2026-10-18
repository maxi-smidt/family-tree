import { useState } from "react";
import { Member, isDeceased } from "@/types/member";
import { useTranslation } from "react-i18next";
import { MemberDetailDialog } from "@/components/shared/dialog/MemberDetailDialog";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { formatDate as formatLocaleDate } from "@/utils/dateUtils";
import { cn } from "@/lib/utils";

type Props = {
  member: Member;
  /** The large, centred presentation used in the person panel and dialog. */
  largeImage?: boolean;
  disableNameLink?: boolean;
};

// A canvas card shows just the years ("1921 – 1994"); the full dates are in
// its tooltip and in the person panel.
const yearOf = (value: string) => /^\d{4}/.exec(value)?.[0] ?? null;

export const FamilyNodeContent = ({
  member,
  largeImage = false,
  disableNameLink = false,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.node",
  });
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  const compact = !largeImage;

  const nameClass = compact
    ? "block min-w-0 max-w-full truncate text-left text-[14px] font-semibold leading-tight"
    : "block w-full text-center text-xl font-bold leading-tight tracking-tight line-clamp-2";

  const nameEl = disableNameLink ? (
    <span className={nameClass} title={fullName}>
      {fullName}
    </span>
  ) : (
    <button
      type="button"
      className={cn(
        nameClass,
        "nodrag cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring",
      )}
      title={fullName}
      onClick={() => setDetailDialogOpen(true)}
    >
      {fullName}
    </button>
  );

  const sources =
    member.isMerged &&
    member.sourceWorkspaceNames &&
    member.sourceWorkspaceNames.length > 0
      ? member.sourceWorkspaceNames
      : member.sourceWorkspaceName
        ? [member.sourceWorkspaceName]
        : [];

  const sourceBadges = sources.length > 0 && (
    <div
      className={cn(
        "mt-0.5 flex min-w-0 flex-nowrap gap-1",
        !compact && "justify-center",
      )}
    >
      {sources.slice(0, 2).map((tn) => (
        <span
          key={tn}
          title={tn}
          className={cn(
            "inline-flex min-w-0 items-center rounded-full border px-1.5 text-[10.5px] leading-4",
            member.isMerged
              ? "border-primary/20 bg-primary-soft text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span className="truncate">{tn}</span>
        </span>
      ))}
      {sources.length > 2 && (
        <span
          title={sources.join(", ")}
          className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary-soft px-1.5 text-[10.5px] leading-4 text-primary"
        >
          +{sources.length - 2}
        </span>
      )}
    </div>
  );

  const dialog = !disableNameLink && (
    <MemberDetailDialog
      member={member}
      open={detailDialogOpen}
      onOpenChange={setDetailDialogOpen}
    />
  );

  if (compact) {
    return (
      <div className="flex w-full min-w-0 items-center gap-3">
        <MemberAvatar member={member} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          {nameEl}
          <div
            className="truncate text-xs text-muted-foreground tabular-nums"
            title={fullDatesTitle()}
          >
            {formatLifeDates(member.date, true)}
          </div>
          {sourceBadges}
        </div>
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-2">
      <MemberAvatar member={member} size="xl" />
      <div className="w-full max-w-full px-1">{nameEl}</div>
      <div className="text-sm text-muted-foreground tabular-nums">
        {formatLifeDates(member.date, false)}
      </div>
      {sourceBadges}
      {dialog}
    </div>
  );

  function fullDatesTitle() {
    const b = member.date.birth ? formatLocaleDate(member.date.birth) : "";
    const d = member.date.death ? formatLocaleDate(member.date.death) : "";
    return [b, d].filter(Boolean).join(" – ") || undefined;
  }

  function formatLifeDates(
    dates: {
      birth: string | null;
      death: string | null;
    },
    yearsOnly: boolean,
  ) {
    const fmt = (value: string) =>
      yearsOnly
        ? (yearOf(value) ?? formatLocaleDate(value))
        : formatLocaleDate(value);
    const hasBirth = !!dates.birth;
    const hasDeath = !!dates.death;
    const deceased = isDeceased(member);

    // Case 1: No birth date AND not deceased / no death info → render nothing
    if (!hasBirth && !deceased && !hasDeath) {
      return <>&#8202;</>; // hair space to keep the card height consistent
    }

    const birthFormatted = hasBirth ? fmt(dates.birth!) : null;
    const deathFormatted = hasDeath ? fmt(dates.death!) : null;

    const crossMarker = (
      <span
        role="img"
        aria-label={t("life-deceased-unknown")}
        title={t("life-deceased-unknown")}
      >
        †
      </span>
    );

    // Case 3: Deceased with known death date
    if (deceased && hasDeath) {
      if (hasBirth) {
        // birth – death
        return (
          <>
            {birthFormatted} – {deathFormatted}
          </>
        );
      } else {
        // no birth but death known → † death
        return (
          <>
            {crossMarker} {deathFormatted}
          </>
        );
      }
    }

    // Case 4: Deceased, unknown death date
    if (deceased && !hasDeath) {
      if (hasBirth) {
        // birth †
        return (
          <>
            {birthFormatted} {crossMarker}
          </>
        );
      } else {
        // just †
        return crossMarker;
      }
    }

    // Case 2: Living (has birth, not deceased, no death date) → just birth date
    if (hasBirth) {
      return <>{t("born-short", { date: birthFormatted })}</>;
    }

    return null;
  }
};
