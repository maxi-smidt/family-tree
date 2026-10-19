import { CitableField, CITABLE_FIELDS } from "@/types/citation";
import { Member } from "@/types/member";

/** The value of a citable field on a member, as stored ("" when empty). */
export function citableFieldValue(member: Member, field: CitableField): string {
  switch (field) {
    case "first_name":
      return member.firstName || "";
    case "middle_names":
      return member.middleNames || "";
    case "last_name":
      return member.lastName || "";
    case "maiden_name":
      return member.maidenName || "";
    case "baptismal_name":
      return member.baptismalName || "";
    case "date_of_birth":
      return member.date.birth || "";
    case "date_of_death":
      return member.date.death || "";
    case "birthplace":
      return member.birthplace || "";
  }
}

/** The member with one citable field set back to `value`. */
export function withCitableFieldValue(
  member: Member,
  field: CitableField,
  value: string,
): Member {
  switch (field) {
    case "first_name":
      return { ...member, firstName: value };
    case "middle_names":
      return { ...member, middleNames: value };
    case "last_name":
      return { ...member, lastName: value };
    case "maiden_name":
      return { ...member, maidenName: value };
    case "baptismal_name":
      return { ...member, baptismalName: value };
    case "date_of_birth":
      return { ...member, date: { ...member.date, birth: value } };
    case "date_of_death":
      return { ...member, date: { ...member.date, death: value || null } };
    case "birthplace":
      return { ...member, birthplace: value || null };
  }
}

/** The citable fields of a member that have a value: the "key facts" whose
 *  evidence coverage the sheet and Data quality report. */
export function filledCitableFields(member: Member): CitableField[] {
  return CITABLE_FIELDS.filter((field) => citableFieldValue(member, field));
}
