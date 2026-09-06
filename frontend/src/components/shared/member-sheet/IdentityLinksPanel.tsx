import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link2, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { Member } from "@/types/member";
import { IdentityLink, IdentityLinkClaim } from "@/types/identityLink";
import { ProposeIdentityLinkDialog } from "./ProposeIdentityLinkDialog";

type Props = { member: Member };

// Stable references so the zustand selectors below don't return a fresh
// array on every render when there's nothing cached yet (which would defeat
// useSyncExternalStore's identity check and re-render in a loop).
const EMPTY_LINKS: IdentityLink[] = [];
const EMPTY_CLAIMS: IdentityLinkClaim[] = [];

/** Verified/pending cross-workspace identity links plus outgoing claims for
 *  one member (#1014). See app.services.identity_links / identity_link_claims. */
export const IdentityLinksPanel = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.identity-links",
  });
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const role = useWorkspaceStore((s) => s.selectedTree?.role);
  const isOwner = role === "owner";
  const canPropose = role === "owner" || role === "editor";

  const links = useIdentityLinkStore(
    (s) => s.linksByMember[member.id] ?? EMPTY_LINKS,
  );
  const claims = useIdentityLinkStore(
    (s) => s.claimsByMember[member.id] ?? EMPTY_CLAIMS,
  );
  const loadForMember = useIdentityLinkStore((s) => s.loadForMember);
  const approve = useIdentityLinkStore((s) => s.approve);
  const reject = useIdentityLinkStore((s) => s.reject);
  const revoke = useIdentityLinkStore((s) => s.revoke);
  const cancelClaim = useIdentityLinkStore((s) => s.cancelClaim);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [toRevoke, setToRevoke] = useState<IdentityLink | null>(null);
  const [toReject, setToReject] = useState<IdentityLink | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void loadForMember(workspaceId, member.id);
  }, [workspaceId, member.id, loadForMember]);

  if (!workspaceId) return null;

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      console.error(err);
      toast.error(t("action-error"));
    }
  };

  const goToCounterpart = (link: IdentityLink) =>
    run(async () => {
      if (!link.counterpart) return;
      await useWorkspaceStore
        .getState()
        .openTreeById(link.counterpart.workspace_id);
      useMemberSheetStore
        .getState()
        .setOpenSheet(link.counterpart.workspace_id, {
          memberId: link.counterpart.member_id,
          tab: "identity",
          mode: "view",
        });
    });

  const verified = links.filter((l) => l.status === "verified");
  const pending = links.filter((l) => l.status === "proposed");
  const pendingClaims = claims.filter((c) => c.status === "pending");
  const isEmpty =
    verified.length === 0 && pending.length === 0 && pendingClaims.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("title")}
        </h3>
        {canPropose && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setProposeOpen(true)}
          >
            <Link2 className="h-4 w-4" />
            {t("propose")}
          </Button>
        )}
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="space-y-2">
          {verified.map((link) => (
            <Item key={link.id} variant="muted">
              <ItemContent>
                <ItemTitle className="flex items-center gap-1.5">
                  {link.counterpart_protected ? (
                    <>
                      <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground" />
                      {t("protected-counterpart")}
                    </>
                  ) : (
                    (link.counterpart?.display_name ?? t("unnamed-member"))
                  )}
                </ItemTitle>
                <ItemDescription className="flex flex-wrap items-center gap-2">
                  {!link.counterpart_protected && link.counterpart && (
                    <span>{link.counterpart.workspace_name}</span>
                  )}
                  {link.verification_basis === "legacy_dual_write_access" && (
                    <Badge variant="secondary">{t("basis-legacy")}</Badge>
                  )}
                  {!link.counterpart_protected && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => void goToCounterpart(link)}
                    >
                      {t("go-to-member")}
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-destructive"
                      onClick={() => setToRevoke(link)}
                    >
                      {t("revoke")}
                    </Button>
                  )}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}

          {pending.map((link) => (
            <Item key={link.id} variant="muted">
              <ItemContent>
                <ItemTitle>
                  {link.counterpart_protected
                    ? t("protected-counterpart")
                    : (link.counterpart?.display_name ?? t("unnamed-member"))}
                </ItemTitle>
                <ItemDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t("status-pending")}</Badge>
                  {isOwner && (
                    <>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() =>
                          void run(() =>
                            approve(workspaceId, member.id, link.id),
                          )
                        }
                      >
                        {t("approve")}
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-destructive"
                        onClick={() => setToReject(link)}
                      >
                        {t("reject-or-cancel")}
                      </Button>
                    </>
                  )}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}

          {pendingClaims.map((claim) => (
            <Item key={claim.id} variant="muted">
              <ItemContent>
                <ItemTitle>
                  {t("claim-to", { username: claim.target_username })}
                </ItemTitle>
                <ItemDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t("status-invited")}</Badge>
                  {canPropose && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-destructive"
                      onClick={() =>
                        void run(() =>
                          cancelClaim(workspaceId, member.id, claim.id),
                        )
                      }
                    >
                      {t("reject-or-cancel")}
                    </Button>
                  )}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </div>
      )}

      <ProposeIdentityLinkDialog
        open={proposeOpen}
        onOpenChange={setProposeOpen}
        workspaceId={workspaceId}
        member={member}
      />

      <ConfirmDeleteDialog
        open={toRevoke !== null}
        onOpenChange={(open) => !open && setToRevoke(null)}
        onConfirm={() => {
          if (toRevoke)
            void run(() => revoke(workspaceId, member.id, toRevoke.id));
          setToRevoke(null);
        }}
        title={t("confirm-revoke-title")}
        description={t("confirm-revoke-description")}
        cancelText={t("confirm-cancel")}
        confirmText={t("revoke")}
      />

      <ConfirmDeleteDialog
        open={toReject !== null}
        onOpenChange={(open) => !open && setToReject(null)}
        onConfirm={() => {
          if (toReject)
            void run(() => reject(workspaceId, member.id, toReject.id));
          setToReject(null);
        }}
        title={t("confirm-reject-title")}
        description={t("confirm-reject-description")}
        cancelText={t("confirm-cancel")}
        confirmText={t("reject-or-cancel")}
      />
    </div>
  );
};
