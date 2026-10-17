import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Link2, MoreHorizontal } from "lucide-react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageSection } from "@/components/shared/PageSection";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { formatDate } from "@/utils/dateUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import {
  IdentityLink,
  IdentityLinkClaim,
  IdentityLinkEndpoint,
} from "@/types/identityLink";

const initialsOf = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase())
    .join("") || "?";

/** Initials disc for a member we only know by display name. */
function NameDisc({ name }: { name: string | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full bg-gender-o-bg text-xs font-semibold text-gender-o"
    >
      {initialsOf(name)}
    </span>
  );
}

/** One side of a proposed link: who, and in which workspace. */
function EndpointBox({
  endpoint,
  fallback,
  note,
}: {
  endpoint: IdentityLinkEndpoint | null;
  fallback: string;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
      <NameDisc name={endpoint?.display_name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {endpoint?.display_name ?? fallback}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {endpoint ? endpoint.workspace_name : note}
          {endpoint && note ? ` · ${note}` : ""}
        </p>
      </div>
    </div>
  );
}
import { CompleteIdentityLinkClaimDialog } from "./CompleteIdentityLinkClaimDialog";

export const IdentityLinksView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "identity-links-view" });
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const isOwner = selectedTree?.role === "owner";

  const workspaceLinks = useIdentityLinkStore((s) => s.workspaceLinks);
  const incomingClaims = useIdentityLinkStore((s) => s.incomingClaims);
  const outgoingClaims = useIdentityLinkStore((s) => s.outgoingClaims);
  const loadWorkspaceLinks = useIdentityLinkStore((s) => s.loadWorkspaceLinks);
  const loadClaimInbox = useIdentityLinkStore((s) => s.loadClaimInbox);
  const approveWorkspaceLink = useIdentityLinkStore(
    (s) => s.approveWorkspaceLink,
  );
  const rejectWorkspaceLink = useIdentityLinkStore(
    (s) => s.rejectWorkspaceLink,
  );
  const revokeWorkspaceLink = useIdentityLinkStore(
    (s) => s.revokeWorkspaceLink,
  );
  const declineClaim = useIdentityLinkStore((s) => s.declineClaim);
  const cancelOutgoingClaim = useIdentityLinkStore(
    (s) => s.cancelOutgoingClaim,
  );

  const [toComplete, setToComplete] = useState<IdentityLinkClaim | null>(null);
  const [toDecline, setToDecline] = useState<IdentityLinkClaim | null>(null);

  useEffect(() => {
    void loadClaimInbox();
  }, [loadClaimInbox]);

  useEffect(() => {
    if (selectedTree && isOwner) void loadWorkspaceLinks(selectedTree.id);
  }, [selectedTree, isOwner, loadWorkspaceLinks]);

  const run = async (
    action: () => Promise<void>,
    errorKey = "action-error",
  ) => {
    try {
      await action();
    } catch (err) {
      console.error(err);
      toast.error(t(errorKey));
    }
  };

  const pending = workspaceLinks.filter((l) => l.status === "proposed");
  const verified = workspaceLinks.filter((l) => l.status === "verified");
  const waitingCount = pending.length + incomingClaims.length;

  const counterpartLine = (link: IdentityLink) =>
    link.counterpart_protected
      ? t("protected-counterpart")
      : t("also-in", {
          workspace: link.counterpart?.workspace_name ?? "",
          name: link.counterpart?.display_name ?? t("unnamed-member"),
        });

  return (
    <ViewLayout title={t("title")} subtitle={t("subtitle")}>
      <div className="flex max-w-5xl flex-col gap-8 px-1 pb-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>

        <PageSection title={t("waiting")} count={waitingCount}>
          {waitingCount === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2 />
                </EmptyMedia>
                <EmptyTitle>{t("no-incoming-claims")}</EmptyTitle>
                <EmptyDescription>
                  {t("incoming-claims-description")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedTree &&
                pending.map((link) => (
                  <Card key={link.id} className="gap-4 px-5">
                    <p className="text-sm text-muted-foreground">
                      {t("proposed-on", {
                        date: formatDate(link.proposed_at),
                      })}
                    </p>
                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                      <EndpointBox
                        endpoint={link.self}
                        fallback={t("unnamed-member")}
                        note={t("yours")}
                      />
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center self-center rounded-full bg-primary-soft text-primary"
                      >
                        <Link2 className="size-4" />
                      </span>
                      <EndpointBox
                        endpoint={link.counterpart}
                        fallback={t("protected-counterpart")}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        size="sm"
                        onClick={() =>
                          void run(() =>
                            approveWorkspaceLink(selectedTree.id, link.id),
                          )
                        }
                      >
                        <Check />
                        {t("approve")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run(() =>
                            rejectWorkspaceLink(selectedTree.id, link.id),
                          )
                        }
                      >
                        {t("reject-or-cancel")}
                      </Button>
                    </div>
                  </Card>
                ))}
              {incomingClaims.map((claim) => (
                <Card key={claim.id} className="gap-4 px-5">
                  <div className="flex items-center gap-2 text-sm">
                    <AccountAvatar
                      user={{
                        first_name: null,
                        last_name: null,
                        profile_image_url: null,
                      }}
                      className="size-6 text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      {t("claim-from", {
                        username: claim.proposer_username ?? "",
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(claim.created_at)}
                    </span>
                  </div>
                  <EndpointBox
                    endpoint={{
                      workspace_id: claim.source_workspace_id,
                      workspace_name: claim.source_workspace_name,
                      member_id: claim.source_member_id,
                      display_name: claim.source_display_name,
                    }}
                    fallback={t("unnamed-member")}
                    note={claim.note ?? undefined}
                  />
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" onClick={() => setToComplete(claim)}>
                      {t("choose-member")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setToDecline(claim)}
                    >
                      {t("decline")}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {selectedTree && !isOwner && (
            <p className="text-sm text-muted-foreground">{t("owner-only")}</p>
          )}
        </PageSection>

        {selectedTree && isOwner && (
          <PageSection title={t("verified-links")} count={verified.length}>
            {verified.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("no-verified-links")}
              </p>
            ) : (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {verified.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <NameDisc name={link.self.display_name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {link.self.display_name ?? t("unnamed-member")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {counterpartLine(link)}
                        </p>
                      </div>
                      <Badge variant="success">{t("confirmed")}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("more-actions")}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              void run(() =>
                                revokeWorkspaceLink(selectedTree.id, link.id),
                              )
                            }
                          >
                            {t("revoke")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </PageSection>
        )}

        {outgoingClaims.length > 0 && (
          <PageSection
            title={t("outgoing-claims")}
            count={outgoingClaims.length}
          >
            <Card className="gap-0 py-0">
              <ul className="divide-y">
                {outgoingClaims.map((claim) => (
                  <li
                    key={claim.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <NameDisc name={claim.source_display_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {claim.source_display_name ?? t("unnamed-member")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t("claim-to", { username: claim.target_username })}
                      </p>
                    </div>
                    <Badge
                      variant={
                        claim.status === "pending"
                          ? "warning"
                          : claim.status === "completed"
                            ? "success"
                            : "muted"
                      }
                    >
                      {t(`claim-status-${claim.status}`)}
                    </Badge>
                    {claim.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(() => cancelOutgoingClaim(claim.id))
                        }
                      >
                        {t("withdraw")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </PageSection>
        )}
      </div>

      <CompleteIdentityLinkClaimDialog
        claim={toComplete}
        onOpenChange={(open) => !open && setToComplete(null)}
      />

      <ConfirmDeleteDialog
        open={toDecline !== null}
        onOpenChange={(open) => !open && setToDecline(null)}
        onConfirm={() => {
          if (toDecline) void run(() => declineClaim(toDecline.id));
          setToDecline(null);
        }}
        title={t("confirm-decline-title")}
        description={t("confirm-decline-description")}
        cancelText={t("confirm-cancel")}
        confirmText={t("decline")}
      />
    </ViewLayout>
  );
};
