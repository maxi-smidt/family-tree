import { UserIcon } from "lucide-react";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { cn } from "@/lib/utils";
import type { User } from "@/types/user";

type AccountAvatarProps = {
  user: Pick<User, "first_name" | "last_name" | "profile_image_url">;
  className?: string;
};

/** Return initials only when a complete profile name is available. */
export function profileInitials(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (!first || !last) return null;
  return `${Array.from(first)[0]}${Array.from(last)[0]}`.toLocaleUpperCase();
}

/** Shared account avatar with profile-image, initials, then icon fallback. */
export function AccountAvatar({ user, className }: AccountAvatarProps) {
  const initials = profileInitials(
    user.first_name ?? null,
    user.last_name ?? null,
  );
  const fallback = initials ? (
    <span className="font-medium leading-none" data-testid="account-initials">
      {initials}
    </span>
  ) : (
    <UserIcon className="h-1/2 w-1/2" data-testid="account-avatar-icon" />
  );

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground",
        className,
      )}
    >
      <AuthenticatedImage
        src={user.profile_image_url}
        alt=""
        className="h-full w-full object-cover"
        fallback={fallback}
      />
    </div>
  );
}
