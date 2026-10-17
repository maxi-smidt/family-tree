import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { memberFullName } from "@/components/shared/MemberChip";
import { useMemberLife } from "@/hooks/useMemberLife";
import type { Member } from "@/types/member";

interface MemberPeekCardProps {
  member: Member;
  canEdit: boolean;
  onView: () => void;
  onEdit: () => void;
  onAddParent: () => void;
  onAddPartner: () => void;
  onAddChild: () => void;
  onClose: () => void;
}

/**
 * The phone tree's pull-up card: tapping a person shows who they are and the
 * next steps (open the profile, edit, add a relative) without covering the
 * tree. Tapping the canvas or pressing Escape puts it away.
 */
export function MemberPeekCard({
  member,
  canEdit,
  onView,
  onEdit,
  onAddParent,
  onAddPartner,
  onAddChild,
  onClose,
}: MemberPeekCardProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.peek" });
  const life = useMemberLife(member);
  const name = memberFullName(member);
  const line = [life.born, life.deceased ? life.status : life.age]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave Escape to an open profile, menu or dialog on top of the card.
      if (
        e.key !== "Escape" ||
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      aria-label={name}
      data-slot="member-peek-card"
      className="rounded-t-[22px] border-t bg-card px-5 pt-2 pb-4 shadow-[0_-8px_30px_rgba(41,33,20,0.12)]"
    >
      <div
        aria-hidden="true"
        className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-border"
      />
      <div className="flex items-center gap-3.5">
        <MemberAvatar member={member} size="lg" className="size-13 text-lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] leading-tight font-bold tracking-tight">
            {name}
          </h2>
          {line && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {line}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-6 -mr-2 self-start text-muted-foreground"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="lg" className="flex-1" onClick={onView}>
          {t("view-profile")}
        </Button>
        {canEdit && (
          <>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label={t("edit")}
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label={t("add-relative")}
                >
                  <UserPlus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuItem onSelect={onAddParent}>
                  {t("add-parent")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddPartner}>
                  {t("add-partner")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddChild}>
                  {t("add-child")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </section>
  );
}
