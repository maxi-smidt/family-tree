import { Member } from "@/types/member";
import { format } from "date-fns";
import { Mars, User, Venus, VenusAndMars } from "lucide-react";

type Props = {
  member: Member;
  largeImage?: boolean;
};

export const FamilyNodeContent = ({ member, largeImage = false }: Props) => {
  const sizeClass = largeImage ? "size-32" : "size-16";
  const iconSize = largeImage ? 64 : 48;

  const GenderIcon = () => {
    switch (member.gender) {
      case "male":
        return <Mars size={12} className="text-blue-500" />;
      case "female":
        return <Venus size={12} className="text-pink-500" />;
      default:
        return <VenusAndMars size={12} className="text-purple-500" />;
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
        <div className="absolute bottom-0 right-0 bg-white rounded-full p-1 shadow-sm border border-gray-200">
          <GenderIcon />
        </div>
      </div>

      <div className="mt-1">
        <div className="flex h-11 w-full items-center justify-center px-1">
          <span className="font-bold text-lg leading-tight text-center line-clamp-2 text-ellipsis overflow-hidden">
            {member.firstName || "Unknown"} {member.lastName}
          </span>
        </div>

        <div className="text-xs text-gray-500 text-center">
          {formatDate(member.date)}
        </div>
      </div>
    </div>
  );

  function formatDate(dates: { birth: string | null; death: string | null }) {
    const start = dates.birth ? format(dates.birth, "dd.MM.yyyy") : <i>???</i>;
    const end = dates.death ? (
      format(dates.death, "dd.MM.yyyy")
    ) : dates.birth ? (
      <i>ongoing</i>
    ) : (
      <i>???</i>
    );

    return (
      <>
        {start} - {end}
      </>
    );
  }
};
