import { Member } from "@/types/member";
import { format } from "date-fns";

type Props = {
  member: Member;
};

export const DefaultFamilyNode = ({ member }: Props) => {
  return (
    <div>
      {member.imageData ? (
        <img
          src={member.imageData}
          className="size-16 rounded-full object-cover mx-auto bg-gray-100"
          alt="Profile"
        />
      ) : (
        <div className="size-16 flex justify-center items-center rounded-full mx-auto bg-gray-200 text-2xl font-bold text-gray-500">
          ?
        </div>
      )}

      <div className="mt-1">
        <div className="flex h-11 w-full items-center justify-center px-1">
          <span className="font-bold text-lg leading-tight text-center line-clamp-2 wrap-break-word">
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
