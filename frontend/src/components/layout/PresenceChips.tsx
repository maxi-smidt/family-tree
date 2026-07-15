import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOtherPresences } from "@/hooks/usePresenceStore";
import { presenceColor, presenceInitials } from "@/lib/presenceColor";

/** How many avatars to show before collapsing the rest into a "+N" chip. */
const MAX_VISIBLE = 5;

/**
 * Overlapping avatar chips for the users currently active in the open tree
 * (Google-Docs style). Renders nothing when the current user is alone.
 */
export const PresenceChips = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "layout.presence" });
  const others = useOtherPresences();

  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <div
      className="ml-16 mr-4 mt-2 flex justify-end"
      aria-label={t("aria-label", { count: others.length })}
    >
      <div className="flex -space-x-2">
        {visible.map((user) => (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <span
                className="flex size-7 select-none items-center justify-center rounded-full border-2 border-background text-[11px] font-medium text-white"
                style={{ backgroundColor: presenceColor(user.userId) }}
              >
                {presenceInitials(user.displayName)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {user.editingMemberId
                ? t("editing-tooltip", { name: user.displayName })
                : user.displayName}
            </TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <span
            className="flex size-7 select-none items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-medium text-muted-foreground"
            title={t("more", { count: overflow })}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
};
