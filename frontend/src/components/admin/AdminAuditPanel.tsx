import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminAuditEntry, AdminService } from "@/services/AdminService";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/utils/dateUtils";

export function AdminAuditPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.audit" });
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      setEntries(await AdminService.listAuditLog());
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading)
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("error")}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("actor")}</TableHead>
              <TableHead>{t("action")}</TableHead>
              <TableHead>{t("subject")}</TableHead>
              <TableHead>{t("details")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDateTime(entry.created_at)}
                </TableCell>
                <TableCell>{entry.actor_username ?? t("unknown")}</TableCell>
                <TableCell>{t(`actions.${entry.action}`)}</TableCell>
                <TableCell>
                  {entry.subject_label ?? entry.subject_type}
                  {entry.subject_label && ` (${entry.subject_type})`}
                </TableCell>
                <TableCell className="max-w-80 whitespace-pre-wrap break-words font-mono text-xs">
                  {entry.details ? JSON.stringify(entry.details) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
