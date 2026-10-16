import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MemberChip } from "@/components/shared/MemberChip";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Member } from "@/types/member";

const PARTNER_TYPES = new Set(["partner", "married", "divorced"]);

type Group = { key: string; label: string; people: Member[] };

/**
 * Parents, partners, children and siblings of a member as clickable chips,
 * so the person panel doubles as a way to walk the family.
 */
export const MemberFamily = ({
  member,
  onOpenMember,
}: {
  member: Member;
  onOpenMember?: (memberId: string) => void;
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

    return [
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
    ].filter((g) => g.people.length > 0);
  }, [members, member, t]);

  if (groups.length === 0) return null;

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
