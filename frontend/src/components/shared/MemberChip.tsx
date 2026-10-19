import { useTranslation } from "react-i18next";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { cn } from "@/lib/utils";
import { isDeceased, type Member } from "@/types/member";

const yearOf = (value: string | null | undefined) =>
  value ? (/^\d{4}/.exec(value)?.[0] ?? null) : null;

/** Compact life span for chips and rows: "1919–88", "† 1994", "1952". */
export function shortLifeSpan(member: Member): string {
  const born = yearOf(member.date.birthSort ?? member.date.birth);
  const died = yearOf(member.date.deathSort ?? member.date.death);
  if (born && died) return `${born}–${died.slice(2)}`;
  if (died) return `† ${died}`;
  if (born) return isDeceased(member) ? `${born} †` : born;
  return "";
}

export function memberFullName(member: Pick<Member, "firstName" | "lastName">) {
  return [member.firstName, member.lastName].filter(Boolean).join(" ");
}

interface MemberChipProps {
  member: Member;
  /** Show the full name instead of the first name only. */
  fullName?: boolean;
  /** Hide the life span. */
  hideLife?: boolean;
  onOpen?: (memberId: string) => void;
  className?: string;
  title?: string;
}

/**
 * A person as a pill: avatar, name, life span. Clickable when `onOpen` is
 * given, so lists of relatives, affected people or link candidates all walk
 * to the person the same way.
 */
export function MemberChip({
  member,
  fullName = false,
  hideLife = false,
  onOpen,
  className,
  title,
}: MemberChipProps) {
  const { t } = useTranslation();
  const name = memberFullName(member);
  const life = hideLife ? "" : shortLifeSpan(member);
  const content = (
    <>
      <MemberAvatar member={member} size="xs" />
      <span className="truncate font-medium">
        {fullName ? name : member.firstName || name}
      </span>
      {life && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {life}
        </span>
      )}
    </>
  );
  const base =
    "inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-card py-0 pr-3 pl-1 text-[13px]";
  if (!onOpen) {
    return (
      <span title={title ?? name} className={cn(base, className)}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title ?? name}
      aria-label={t("common.open-person", { name })}
      className={cn(
        base,
        "cursor-pointer transition-colors hover:border-input hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      onClick={() => onOpen(member.id)}
    >
      {content}
    </button>
  );
}
