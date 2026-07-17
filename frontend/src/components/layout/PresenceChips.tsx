import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { cn } from "@/lib/utils";

/** How many avatars to show before collapsing the rest into a "+N" chip. */
const MAX_VISIBLE = 5;

/**
 * Overlapping avatar chips for the users currently active in the open tree
 * (Google-Docs style), including the current user. Each chip reuses the shared
 * account avatar (profile picture → initials → icon fallback); profile images
 * are self-only, so only the current user's own photo can be shown. A user
 * actively editing a member's sheet gets a highlighted ring. Renders nothing
 * until presence data has arrived.
 */
export const PresenceChips = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "layout.presence" });
  const roster = usePresenceStore((s) => s.roster);
  const currentUser = useAuthStore((s) => s.user);

  if (roster.length === 0) return null;

  const visible = roster.slice(0, MAX_VISIBLE);
  const overflow = roster.length - visible.length;

  return (
    <div
      className="flex -space-x-2"
      aria-label={t("aria-label", { count: roster.length })}
    >
      {visible.map((user) => {
        const isSelf = currentUser?.id === user.userId;
        // Only our own profile image is fetchable (self-only media); everyone
        // else falls back to initials/icon from their name.
        const avatarUser =
          isSelf && currentUser
            ? currentUser
            : {
                first_name: user.firstName,
                last_name: user.lastName,
                profile_image_url: null,
              };
        return (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <AccountAvatar
                  user={avatarUser}
                  className={cn(
                    "size-8 border-2 border-background text-[11px] shadow-sm",
                    user.editingMemberId &&
                      "ring-2 ring-amber-500 ring-offset-1 ring-offset-background",
                  )}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {user.editingMemberId
                ? t("editing-tooltip", { name: user.displayName })
                : user.displayName}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <span
          className="flex size-8 select-none items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-medium text-muted-foreground shadow-sm"
          title={t("more", { count: overflow })}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
};
