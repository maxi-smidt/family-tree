import { Badge } from "@/components/ui/badge";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { memberFullName } from "@/components/shared/MemberChip";
import { useMemberLife } from "@/hooks/useMemberLife";
import type { Member } from "@/types/member";

/**
 * The top of a person's profile on a phone: large avatar, name, where and
 * when they were born, and whether they are living (with their age).
 */
export function MemberProfileHero({ member }: { member: Member }) {
  const life = useMemberLife(member);
  const name = [member.academicTitle, memberFullName(member)]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="mb-5 flex flex-col items-center gap-2 pt-1 text-center">
      <MemberAvatar member={member} size="xl" className="size-19 text-[26px]" />
      <h2 className="mt-1 text-[28px] leading-tight font-bold tracking-tight text-balance">
        {name}
      </h2>
      {life.born && (
        <p className="text-sm text-muted-foreground">{life.born}</p>
      )}
      <Badge
        variant={life.deceased ? "muted" : "success"}
        className="h-7 rounded-full px-3 text-[12.5px]"
      >
        {life.status}
      </Badge>
    </div>
  );
}
