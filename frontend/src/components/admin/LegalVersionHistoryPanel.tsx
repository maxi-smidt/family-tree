import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import {
  LegalDocumentType,
  LegalDocumentVersionDetail,
  LegalDocumentVersionSummary,
  LegalService,
} from "@/services/LegalService";
import { formatDateTime } from "@/utils/dateUtils";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface Props {
  /** Which document type's history to show. */
  documentType: LegalDocumentType;
  /** Which locale's history to show (German and English are tracked separately). */
  locale: string;
}

/**
 * Read-only history of immutably snapshotted versions for one legal document
 * type (Terms / Privacy / Impressum). Every distinct body that was ever
 * published gets its own row here (see `LegalDocumentVersion` on the
 * backend) — editing the live text in the form above never loses the old
 * wording, and a past acceptance can always be traced back to its exact text.
 */
export function LegalVersionHistoryPanel({ documentType, locale }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin" });
  const [versions, setVersions] = useState<
    LegalDocumentVersionSummary[] | null
  >(null);
  const [viewing, setViewing] = useState<LegalDocumentVersionDetail | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    LegalService.listVersions()
      .then((all) => {
        if (!cancelled)
          setVersions(
            all.filter(
              (v) => v.document_type === documentType && v.locale === locale,
            ),
          );
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) toast.error(t("legal-history-load-error"));
      });
    return () => {
      cancelled = true;
    };
  }, [documentType, locale, t]);

  const viewVersion = async (id: string) => {
    setLoadingId(id);
    try {
      setViewing(await LegalService.getVersion(id));
    } catch (err) {
      console.error(err);
      toast.error(t("legal-history-load-error"));
    } finally {
      setLoadingId(null);
    }
  };

  if (versions === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("legal-history-empty")}
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("legal-history-published-at")}</TableHead>
            <TableHead>{t("legal-history-version")}</TableHead>
            <TableHead>{t("legal-history-hash")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{formatDateTime(v.published_at)}</TableCell>
              <TableCell>{v.version}</TableCell>
              <TableCell className="font-mono text-xs">
                {v.content_hash.slice(0, 12)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingId === v.id}
                  onClick={() => void viewVersion(v.id)}
                >
                  {t("legal-history-view")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={!!viewing}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {viewing
                ? t("legal-history-detail-title", { version: viewing.version })
                : ""}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="overflow-y-auto max-h-[60vh]">
              <MarkdownContent content={viewing.body} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
