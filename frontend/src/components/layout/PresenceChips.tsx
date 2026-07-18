import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { cn } from "@/lib/utils";

/** How many avatars to show before collapsing the rest into a "+N" chip. */
const MAX_VISIBLE = 5;

/**
 * Overlapping avatar chips for the users currently active in the open tree
 * (Google-Docs style), including the current user. Each chip reuses the shared
 * account avatar (profile picture → initials → icon fallback). Accepted
 * friends use their friendship-scoped profile image; other collaborators use
 * initials or the icon fallback. A user actively editing or making a tree
 * change gets a highlighted ring. Renders nothing until presence data arrives.
 */
export const PresenceChips = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "layout.presence" });
  const roster = usePresenceStore((s) => s.roster);
  const recentlyActiveUserIds = usePresenceStore(
    (s) => s.recentlyActiveUserIds,
  );
  const currentUser = useAuthStore((s) => s.user);
  const friends = useFriendStore((s) => s.friends);
  const loadFriends = useFriendStore((s) => s.loadFriends);

  useEffect(() => {
    if (currentUser) void loadFriends();
  }, [currentUser, loadFriends]);

  const friendImageUrls = useMemo(
    () =>
      new Map(
        friends
          .filter((friend) => friend.status === "accepted")
          .map((friend) => [friend.user_id, friend.profile_image_url]),
      ),
    [friends],
  );

  if (roster.length === 0) return null;

  const visible = roster.slice(0, MAX_VISIBLE);
  const overflowUsers = roster.slice(MAX_VISIBLE);

  return (
    <div
      className="flex -space-x-2"
      aria-label={t("aria-label", { count: roster.length })}
    >
      {visible.map((user) => {
        const isSelf = currentUser?.id === user.userId;
        const isEditing =
          user.editingMemberId !== null ||
          recentlyActiveUserIds.includes(user.userId);
        // Friend images use an authenticated, friendship-scoped URL. A tree
        // collaborator with no accepted friendship never receives one.
        const avatarUser =
          isSelf && currentUser
            ? currentUser
            : {
                first_name: user.firstName,
                last_name: user.lastName,
                profile_image_url: friendImageUrls.get(user.userId) ?? null,
              };
        return (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <AccountAvatar
                  user={avatarUser}
                  className={cn(
                    "size-8 border-2 border-background text-[11px] shadow-sm",
                    isEditing &&
                      "ring-2 ring-amber-500 ring-offset-1 ring-offset-background",
                  )}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isEditing
                ? t("editing-tooltip", { name: user.displayName })
                : user.displayName}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {overflowUsers.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex size-8 select-none items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-medium text-muted-foreground shadow-sm"
              aria-label={t("more", { count: overflowUsers.length })}
            >
              +{overflowUsers.length}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-1">
              {overflowUsers.map((user) => {
                const isEditing =
                  user.editingMemberId !== null ||
                  recentlyActiveUserIds.includes(user.userId);
                return (
                  <span key={user.userId}>
                    {isEditing
                      ? t("editing-tooltip", { name: user.displayName })
                      : user.displayName}
                  </span>
                );
              })}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
