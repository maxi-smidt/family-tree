import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSectionStore } from "@/hooks/useSectionStore";
import { SectionDB, SectionDependentsDB } from "@/types/section";

interface DeleteSectionDialogProps {
  section: SectionDB | null;
  onOpenChange: (open: boolean) => void;
}

/** Deleting a section never widens the audience of what it held (#982):
 * scoped grants/invitations/public links and any content still provenanced
 * to it block the delete until resolved elsewhere, so this only offers a
 * confirm action once the dependents check comes back clear. */
export const DeleteSectionDialog = ({
  section,
  onOpenChange,
}: DeleteSectionDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.delete-section",
  });
  const getSectionDependents = useSectionStore((s) => s.getSectionDependents);
  const deleteSection = useSectionStore((s) => s.deleteSection);

  const [dependents, setDependents] = useState<SectionDependentsDB | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!section) {
      setDependents(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    getSectionDependents(section.id)
      .then((result) => {
        if (!cancelled) setDependents(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("load-error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, getSectionDependents, t]);

  const blockedContent = dependents
    ? Object.entries(dependents.content_scope_counts).filter(
        ([, count]) => count > 0,
      )
    : [];
  const blocked = dependents
    ? dependents.grant_count > 0 ||
      dependents.invitation_count > 0 ||
      dependents.public_link_count > 0 ||
      blockedContent.length > 0
    : false;
  // Only a dependents check that actually came back clear may enable the
  // delete action — a still-loading or failed check (`dependents === null`)
  // must never be read as "nothing blocks this."
  const canDelete = !loading && !loadError && dependents !== null && !blocked;

  const handleDelete = async () => {
    if (!section || !canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSection(section.id);
      onOpenChange(false);
    } catch {
      setError(t("delete-error"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={section !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { name: section?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {loading && t("loading")}
            {!loading &&
              !loadError &&
              !blocked &&
              t("description", { count: dependents?.member_count ?? 0 })}
            {!loading && !loadError && blocked && t("blocked-description")}
            {!loading && loadError && loadError}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!loading && blocked && dependents && (
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {dependents.grant_count > 0 && (
              <li>{t("blocked-grants", { count: dependents.grant_count })}</li>
            )}
            {dependents.invitation_count > 0 && (
              <li>
                {t("blocked-invitations", {
                  count: dependents.invitation_count,
                })}
              </li>
            )}
            {dependents.public_link_count > 0 && (
              <li>
                {t("blocked-public-links", {
                  count: dependents.public_link_count,
                })}
              </li>
            )}
            {blockedContent.map(([domain, count]) => (
              <li key={domain}>{t("blocked-content", { domain, count })}</li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            {canDelete ? t("cancel") : t("close")}
          </AlertDialogCancel>
          {canDelete && (
            // A plain button, not AlertDialogAction: Radix's Action closes
            // the controlled dialog unconditionally on click, which would
            // dismiss this dialog before we know whether the delete
            // succeeded and strand the error message in an already-closed
            // dialog. Closing only happens explicitly, inside handleDelete,
            // once the request succeeds.
            <Button
              onClick={() => void handleDelete()}
              variant="destructive"
              disabled={deleting}
            >
              {deleting ? t("deleting") : t("confirm")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
