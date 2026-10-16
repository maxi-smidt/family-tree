import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { cn } from "@/lib/utils";
import type { Member } from "@/types/member";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-xl",
  xl: "size-24 text-3xl",
};

const TONE_CLASSES: Record<string, string> = {
  m: "bg-gender-m-bg text-gender-m",
  f: "bg-gender-f-bg text-gender-f",
};
const DEFAULT_TONE = "bg-gender-o-bg text-gender-o";

export function memberInitials(
  member: Pick<Member, "firstName" | "lastName">,
): string {
  const first = Array.from(member.firstName?.trim() ?? "")[0] ?? "";
  const last = Array.from(member.lastName?.trim() ?? "")[0] ?? "";
  return (first + last).toLocaleUpperCase() || "?";
}

interface MemberAvatarProps {
  member: Pick<Member, "firstName" | "lastName" | "gender" | "imageData">;
  size?: AvatarSize;
  className?: string;
}

/**
 * A person's avatar: their photo when one is set, otherwise their initials on
 * a muted tint for their gender. Decorative — the name is always rendered
 * next to it, so it is hidden from assistive technology.
 */
export const MemberAvatar = ({
  member,
  size = "md",
  className,
}: MemberAvatarProps) => {
  const base = cn(
    "inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold tracking-wide select-none",
    SIZE_CLASSES[size],
    TONE_CLASSES[member.gender ?? ""] ?? DEFAULT_TONE,
    className,
  );
  const initials = (
    <span aria-hidden="true" className={base}>
      {memberInitials(member)}
    </span>
  );

  if (!member.imageData) return initials;

  return (
    <AuthenticatedImage
      src={member.imageData}
      alt=""
      className={cn(base, "object-cover")}
      fallback={initials}
    />
  );
};
