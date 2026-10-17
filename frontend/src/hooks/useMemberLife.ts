import { useTranslation } from "react-i18next";
import { isDeceased, type Member } from "@/types/member";
import { formatDate } from "@/utils/dateUtils";
import { computeAge } from "@/utils/memberAge";

export interface MemberLife {
  /** "Born 28 Feb 1976 in Wien", or null when neither date nor place is known. */
  born: string | null;
  /** "Living · 50 years" / "† 2 Nov 1994 · aged 73" / "Deceased". */
  status: string;
  /** "50 years" for the living, "aged 73" for the deceased. */
  age: string | null;
  deceased: boolean;
}

/**
 * The one-line life summary used wherever a person is introduced on a phone
 * (the pull-up card on the tree, the profile header), so both read the same.
 */
export function useMemberLife(member: Member): MemberLife {
  const { t } = useTranslation(undefined, { keyPrefix: "common.life" });
  const date = member.date.birth ? formatDate(member.date.birth) : null;
  const place = member.birthplace || null;
  const born =
    date && place
      ? t("born-in", { date, place })
      : date
        ? t("born", { date })
        : place
          ? t("born-place", { place })
          : null;

  const deceased = isDeceased(member);
  const { age: years } = computeAge(member);
  const deathDate = member.date.death ? formatDate(member.date.death) : null;

  const status = deceased
    ? deathDate
      ? years !== null
        ? t("died-aged", { date: deathDate, count: years })
        : t("died", { date: deathDate })
      : t("deceased")
    : years !== null
      ? t("living-years", { count: years })
      : t("living");

  const age =
    years === null
      ? null
      : deceased
        ? t("aged", { count: years })
        : t("years", { count: years });

  return { born, status, age, deceased };
}
