import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMigrationReviewStore } from "@/hooks/useMigrationReviewStore";
import { GrantAccessSummary } from "@/types/migration";

interface Props {
  reportId: string;
  sectionId: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AccessSummaryCard({ summary }: { summary: GrantAccessSummary }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view.widen-dialog",
  });
  const { t: tShare } = useTranslation(undefined, {
    keyPrefix: "dialog.share-tree",
  });
  const roleLabel =
    summary.role === "editor" || summary.role === "viewer"
      ? tShare(`role-${summary.role}`)
      : summary.role;
  return (
    <div className="rounded-md border p-3 space-y-1">
      <p className="text-sm font-medium">
        {summary.scope === "workspace"
          ? t("scope-workspace")
          : t("scope-section")}
      </p>
      <p className="text-xs text-muted-foreground">{roleLabel}</p>
      <div className="flex flex-wrap gap-1">
        {summary.restrictions.length === 0 ? (
          <Badge variant="secondary">{t("no-restrictions")}</Badge>
        ) : (
          summary.restrictions.map((r) => (
            <Badge key={r} variant="secondary">
              {tShare(`domains.${r}`, { defaultValue: r })}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export const GrantWidenDialog = ({
  reportId,
  sectionId,
  userId,
  open,
  onOpenChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view.widen-dialog",
  });
  const widenGrant = useMigrationReviewStore((s) => s.widenGrant);
  const [result, setResult] = useState<{
    before: GrantAccessSummary;
    after: GrantAccessSummary;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const outcome = await widenGrant(reportId, sectionId, userId);
      setResult(outcome);
    } catch {
      toast.error(t("error"));
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (!next) setResult(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {result ? t("done-description") : t("description")}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid grid-cols-2 gap-3">
            <AccessSummaryCard summary={result.before} />
            <AccessSummaryCard summary={result.after} />
          </div>
        ) : null}
        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>{t("close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {t("cancel")}
              </Button>
              <Button
                onClick={() => void handleConfirm()}
                disabled={submitting}
              >
                {t("confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
