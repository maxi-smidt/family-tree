import { useState } from "react";
import { Member, isDeceased } from "@/types/member";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Mars, User, Venus, VenusAndMars } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MemberDetailDialog } from "@/components/shared/dialog/MemberDetailDialog";
import { formatDate as formatLocaleDate } from "@/utils/dateUtils";

type Props = {
  member: Member;
  largeImage?: boolean;
  disableNameLink?: boolean;
};

export const FamilyNodeContent = ({
  member,
  largeImage = false,
  disableNameLink = false,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.node",
  });
  const sizeClass = largeImage ? "size-32" : "size-16";
  const iconSize = largeImage ? 64 : 48;
  const genderIconSize = largeImage ? 20 : 12;
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const GenderIcon = () => {
    switch (member.gender) {
      case "m":
        return <Mars size={genderIconSize} className="text-blue-500" />;
      case "f":
        return <Venus size={genderIconSize} className="text-pink-500" />;
      default:
        return (
          <VenusAndMars size={genderIconSize} className="text-purple-500" />
        );
    }
  };

  return (
    // w-full/min-w-0 pins the content to the card width (the card centers its
    // children, so an unconstrained child would grow past it) — required for
    // the badge row below to truncate instead of overflowing.
    <div className="w-full min-w-0">
      <div className="relative w-fit mx-auto">
        {member.imageData ? (
          <AuthenticatedImage
            src={member.imageData}
            className={`${sizeClass} rounded-full object-cover bg-muted`}
            alt=""
          />
        ) : (
          <div
            aria-hidden="true"
            className={`${sizeClass} flex justify-center items-center rounded-full bg-muted text-2xl font-bold text-muted-foreground`}
          >
            <User size={iconSize} />
          </div>
        )}
        <div
          aria-hidden="true"
          className={`absolute bg-card rounded-full shadow-sm border border-border flex items-center justify-center bottom-0 right-0 ${
            largeImage ? "p-2" : "p-1"
          }`}
        >
          <GenderIcon />
        </div>
      </div>

      <div className="mt-1">
        <div className="flex h-11 w-full items-center justify-center px-1">
          {disableNameLink ? (
            <span className="font-bold text-lg leading-tight text-center line-clamp-2 overflow-hidden block w-full max-w-full p-1">
              {member.firstName} {member.lastName}
            </span>
          ) : (
            <Button
              variant="link"
              className="h-auto p-1 w-full max-w-full block whitespace-normal"
              onClick={() => setDetailDialogOpen(true)}
            >
              <span className="font-bold text-lg leading-tight text-center line-clamp-2 text-ellipsis overflow-hidden">
                {member.firstName} {member.lastName}
              </span>
            </Button>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center">
          {formatLifeDates(member.date)}
        </div>
        {/* Badges stay on a single row (long names truncate, at most two are
            shown plus a "+N" pill) so every card in a virtual view has the
            same height — equal heights keep the side handles level and the
            partner connector lines straight. */}
        {member.isMerged &&
        member.sourceTreeNames &&
        member.sourceTreeNames.length > 0 ? (
          <div className="mt-1 flex flex-nowrap justify-center gap-1 w-full min-w-0 px-1">
            {member.sourceTreeNames.slice(0, 2).map((tn) => (
              <span
                key={tn}
                title={tn}
                className="inline-flex min-w-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary border border-primary/20"
              >
                <span className="truncate">{tn}</span>
              </span>
            ))}
            {member.sourceTreeNames.length > 2 && (
              <span
                title={member.sourceTreeNames.join(", ")}
                className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary border border-primary/20"
              >
                +{member.sourceTreeNames.length - 2}
              </span>
            )}
          </div>
        ) : (
          member.sourceTreeName && (
            <div className="mt-1 flex justify-center w-full min-w-0 px-1">
              <span
                title={member.sourceTreeName}
                className="inline-flex min-w-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground border border-border"
              >
                <span className="truncate">{member.sourceTreeName}</span>
              </span>
            </div>
          )
        )}
      </div>
      {!disableNameLink && (
        <MemberDetailDialog
          member={member}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
        />
      )}
    </div>
  );

  function formatLifeDates(dates: {
    birth: string | null;
    death: string | null;
  }) {
    const hasBirth = !!dates.birth;
    const hasDeath = !!dates.death;
    const deceased = isDeceased(member);

    // Case 1: No birth date AND not deceased / no death info → render nothing
    if (!hasBirth && !deceased && !hasDeath) {
      return <>&#8202;</>; // hair space to keep the card height consistent
    }

    const birthFormatted = hasBirth ? formatLocaleDate(dates.birth!) : null;
    const deathFormatted = hasDeath ? formatLocaleDate(dates.death!) : null;

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
      return <>{birthFormatted}</>;
    }

    return null;
  }
};
