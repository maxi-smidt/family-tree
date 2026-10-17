import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import {
  MemberChip,
  memberFullName,
  shortLifeSpan,
} from "@/components/shared/MemberChip";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Member } from "@/types/member";

const PARTNER_TYPES = new Set(["partner", "married", "divorced"]);

type GroupKey = "parents" | "partners" | "children" | "siblings";
type Group = { key: GroupKey; label: string; people: Member[] };

const genderKey = (member: Member) =>
  member.gender === "m" ? "male" : member.gender === "f" ? "female" : "other";

/**
 * Parents, partners, children and siblings of a member as clickable chips,
 * so the person panel doubles as a way to walk the family.
 */
export const MemberFamily = ({
  member,
  onOpenMember,
  layout = "chips",
}: {
  member: Member;
  onOpenMember?: (memberId: string) => void;
  /**
   * `chips` groups people by relation (the side panel); `rows` lists each
   * relative on their own row, "Father · 1949–21", as on the phone profile.
   */
  layout?: "chips" | "rows";
}) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.view-mode" });
  const members = useMemberStore((s) => s.members);

  const groups = useMemo<Group[]>(() => {
    const byId = new Map(members.map((m) => [m.id, m]));
    const parentIds = [
      member.parents.paternalParent,
      member.parents.maternalParent,
    ].filter((id): id is string => !!id);
    const parents = parentIds
      .map((id) => byId.get(id))
      .filter((m): m is Member => !!m);

    const partnerIds = new Set<string>();
    for (const m of members) {
      for (const r of m.relations ?? []) {
        if (!PARTNER_TYPES.has(r.relationType)) continue;
        if (r.fromMemberId === member.id) partnerIds.add(r.toMemberId);
        if (r.toMemberId === member.id) partnerIds.add(r.fromMemberId);
      }
    }
    partnerIds.delete(member.id);
    const partners = [...partnerIds]
      .map((id) => byId.get(id))
      .filter((m): m is Member => !!m);

    const children = members.filter(
      (m) =>
        m.id !== member.id &&
        (m.parents.paternalParent === member.id ||
          m.parents.maternalParent === member.id),
    );

    const siblings =
      parentIds.length === 0
        ? []
        : members.filter(
            (m) =>
              m.id !== member.id &&
              parentIds.some(
                (pid) =>
                  m.parents.paternalParent === pid ||
                  m.parents.maternalParent === pid,
              ),
          );

    const sortByBirth = (list: Member[]) =>
      [...list].sort((a, b) =>
        (a.date.birthSort ?? a.date.birth ?? "").localeCompare(
          b.date.birthSort ?? b.date.birth ?? "",
        ),
      );

    const result: Group[] = [
      { key: "parents", label: t("family-parents"), people: parents },
      { key: "partners", label: t("family-partners"), people: partners },
      {
        key: "children",
        label: t("family-children"),
        people: sortByBirth(children),
      },
      {
        key: "siblings",
        label: t("family-siblings"),
        people: sortByBirth(siblings),
      },
    ];
    return result.filter((g) => g.people.length > 0);
  }, [members, member, t]);

  // How each partner is related — married partners read as husband/wife.
  const partnerTypes = useMemo(() => {
    const types = new Map<string, string>();
    for (const m of members) {
      for (const r of m.relations ?? []) {
        if (!PARTNER_TYPES.has(r.relationType)) continue;
        if (r.fromMemberId === member.id)
          types.set(r.toMemberId, r.relationType);
        if (r.toMemberId === member.id)
          types.set(r.fromMemberId, r.relationType);
      }
    }
    return types;
  }, [members, member.id]);

  if (groups.length === 0) return null;

  const relationLabel = (group: GroupKey, person: Member) => {
    const g = genderKey(person);
    if (group === "partners") {
      const type = partnerTypes.get(person.id);
      return type === "married"
        ? t(`relation.spouse.${g}`)
        : type === "divorced"
          ? t("relation.former-partner")
          : t("relation.partner");
    }
    const base =
      group === "parents"
        ? "parent"
        : group === "children"
          ? "child"
          : "sibling";
    return t(`relation.${base}.${g}`);
  };

  if (layout === "rows") {
    return (
      <section aria-labelledby="member-family-heading" className="mb-5">
        <h3
          id="member-family-heading"
          className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
        >
          {t("family")}
        </h3>
        <ul className="overflow-hidden rounded-2xl border bg-card">
          {groups.flatMap((group) =>
            group.people.map((person) => {
              const name = memberFullName(person);
              const life = shortLifeSpan(person);
              const detail = [relationLabel(group.key, person), life]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={`${group.key}-${person.id}`}
                  className="border-t first:border-t-0"
                >
                  <button
                    type="button"
                    className="flex min-h-15 w-full items-center gap-3 py-2 pr-2 pl-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => onOpenMember?.(person.id)}
                  >
                    <MemberAvatar
                      member={person}
                      size="sm"
                      className="size-9"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {detail}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4.5 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              );
            }),
          )}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="member-family-heading" className="mb-5">
      <h3
        id="member-family-heading"
        className="mb-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
      >
        {t("family")}
      </h3>
      <dl className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <div
            key={group.key}
            className="grid grid-cols-[5.5rem_1fr] items-start gap-2"
          >
            <dt className="pt-1.5 text-[13px] text-muted-foreground">
              {group.label}
            </dt>
            <dd className="m-0 flex flex-wrap gap-1.5">
              {group.people.map((person) => (
                <MemberChip
                  key={person.id}
                  member={person}
                  onOpen={onOpenMember}
                />
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
