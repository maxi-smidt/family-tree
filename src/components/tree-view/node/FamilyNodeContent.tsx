import { Member } from "@/types/member";
import { format } from "date-fns";
import { ExternalLink, Mars, User, Venus, VenusAndMars } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { MemberDetailDialog } from "@/components/member-detail/MemberDetailDialog";

type Props = {
  member: Member;
  largeImage?: boolean;
};

export const FamilyNodeContent = ({ member, largeImage = false }: Props) => {
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
    <div>
      <div className="relative w-fit mx-auto">
        {member.imageData ? (
          <img
            src={member.imageData}
            className={`${sizeClass} rounded-full object-cover bg-gray-100`}
            alt="Profile"
          />
        ) : (
          <div
            className={`${sizeClass} flex justify-center items-center rounded-full bg-gray-200 text-2xl font-bold text-gray-500`}
          >
            <User size={iconSize} />
          </div>
        )}
        <div
          className={`absolute bg-white rounded-full shadow-sm border border-gray-200 flex items-center justify-center bottom-0 right-0 ${
            largeImage ? "p-2" : "p-1"
          }`}
        >
          <GenderIcon />
        </div>
      </div>

      <div className="mt-1">
        <div className="flex h-11 w-full items-center justify-center px-1">
          <div className="flex items-center gap-1">
            <span className="font-bold text-lg leading-tight text-center line-clamp-2 text-ellipsis overflow-hidden">
              {member.firstName} {member.lastName}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDetailDialogOpen(true)}
            >
              <ExternalLink />
            </Button>
          </div>
        </div>

        <div className="text-xs text-gray-500 text-center">
          {formatDate(member.date)}
        </div>
      </div>
      <MemberDetailDialog
        member={member}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );

  function formatDate(dates: { birth: string | null; death: string | null }) {
    const start = dates.birth ? format(dates.birth, "dd.MM.yyyy") : <i>???</i>;
    const end = dates.death ? (
      format(dates.death, "dd.MM.yyyy")
    ) : dates.birth ? (
      <i>{t("life-ongoing")}</i>
    ) : (
      <i>{t("life-unknown")}</i>
    );

    return (
      <>
        {start} - {end}
      </>
    );
  }
};
