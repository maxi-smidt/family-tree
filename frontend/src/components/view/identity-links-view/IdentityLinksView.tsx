import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Link2, X } from "lucide-react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { IdentityLinkClaim } from "@/types/identityLink";
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

  const [tab, setTab] = useState("links");
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

  return (
    <ViewLayout title={t("title")}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="links">
            {t("tab-links")}
            {pending.length > 0 && (
              <Badge variant="default" className="ml-1.5 px-1.5">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="claims">
            {t("tab-claims")}
            {incomingClaims.length > 0 && (
              <Badge variant="default" className="ml-1.5 px-1.5">
                {incomingClaims.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="links" className="mt-4 flex-1 space-y-6">
          {!selectedTree ? (
            <p className="text-sm text-muted-foreground">
              {t("no-tree-selected")}
            </p>
          ) : !isOwner ? (
            <p className="text-sm text-muted-foreground">{t("owner-only")}</p>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {t("pending-links")}
                </h2>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("no-pending-links")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pending.map((link) => (
                      <Card
                        key={link.id}
                        className="flex-row items-center gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {link.self.display_name ?? t("unnamed-member")}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {link.counterpart_protected
                              ? t("protected-counterpart")
                              : `${link.counterpart?.display_name ?? t("unnamed-member")} · ${link.counterpart?.workspace_name ?? ""}`}
                          </p>
                        </div>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              approveWorkspaceLink(selectedTree.id, link.id),
                            )
                          }
                        >
                          <Check className="h-4 w-4" />
                          {t("approve")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              rejectWorkspaceLink(selectedTree.id, link.id),
                            )
                          }
                        >
                          <X className="h-4 w-4" />
                          {t("reject-or-cancel")}
                        </Button>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {t("verified-links")}
                </h2>
                {verified.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("no-verified-links")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {verified.map((link) => (
                      <Card
                        key={link.id}
                        className="flex-row items-center gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {link.self.display_name ?? t("unnamed-member")}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {link.counterpart_protected
                              ? t("protected-counterpart")
                              : `${link.counterpart?.display_name ?? t("unnamed-member")} · ${link.counterpart?.workspace_name ?? ""}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() =>
                            void run(() =>
                              revokeWorkspaceLink(selectedTree.id, link.id),
                            )
                          }
                        >
                          {t("revoke")}
                        </Button>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="claims" className="mt-4 flex-1 space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("incoming-claims")}
            </h2>
            {incomingClaims.length === 0 ? (
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
              <div className="space-y-2">
                {incomingClaims.map((claim) => (
                  <Card
                    key={claim.id}
                    className="flex-row items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t("claim-from", {
                          username: claim.proposer_username ?? "",
                        })}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {claim.source_display_name ?? t("unnamed-member")}
                        {claim.note ? ` — ${claim.note}` : ""}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => setToComplete(claim)}>
                      {t("choose-member")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToDecline(claim)}
                    >
                      {t("decline")}
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("outgoing-claims")}
            </h2>
            {outgoingClaims.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("no-outgoing-claims")}
              </p>
            ) : (
              <div className="space-y-2">
                {outgoingClaims.map((claim) => (
                  <Card
                    key={claim.id}
                    className="flex-row items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t("claim-to", { username: claim.target_username })}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t(`claim-status-${claim.status}`)}
                      </p>
                    </div>
                    {claim.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(() =>
                            cancelOutgoingClaim(
                              claim.source_workspace_id,
                              claim.id,
                            ),
                          )
                        }
                      >
                        {t("reject-or-cancel")}
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

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
