import { useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field";
import type { AdminSettings, BackupRecord } from "@/services/AdminService";
import { formatDateTime } from "@/utils/dateUtils";
import { formatFileSize } from "@/utils/attachmentUtils";
import { toast } from "sonner";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { useAdminBackupStore } from "@/hooks/useAdminBackupStore";

type Props = {
  settings: AdminSettings | null;
  onSettingsChange: (s: AdminSettings) => void;
  onSaveSettings: () => void;
};

export const BackupPanel = ({
  settings,
  onSettingsChange,
  onSaveSettings,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.backups" });
  const backupTick = useAdminViewStore((s) => s.backupTick);
  const backups = useAdminBackupStore((s) => s.backups);
  const triggering = useAdminBackupStore((s) => s.triggering);
  const downloadingId = useAdminBackupStore((s) => s.downloadingId);
  const loadBackups = useAdminBackupStore((s) => s.loadBackups);
  const triggerBackup = useAdminBackupStore((s) => s.triggerBackup);
  const deleteBackup = useAdminBackupStore((s) => s.deleteBackup);
  const downloadBackup = useAdminBackupStore((s) => s.downloadBackup);

  useEffect(() => {
    void loadBackups().catch((err: unknown) => console.error(err));
  }, [loadBackups, backupTick]);

  const handleBackupNow = async () => {
    try {
      const backup = await triggerBackup();
      if (backup.status !== "success") {
        throw new Error(backup.error || "Backup verification failed");
      }
      toast.success(t("created"));
    } catch (err) {
      console.error(err);
      toast.error(t("create-error"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBackup(id);
      toast.success(t("deleted"));
    } catch (err) {
      console.error(err);
      toast.error(t("delete-error"));
    }
  };

  const handleDownload = async (record: BackupRecord) => {
    if (!record.filename) return;
    try {
      const blob = await downloadBackup(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = record.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(t("delete-error"));
    }
  };

  const lastSuccess = backups.find((b) => b.status === "success");

  const statusVariant = (
    status: BackupRecord["status"],
  ): "default" | "secondary" | "destructive" => {
    if (status === "success") return "default";
    if (status === "running") return "secondary";
    return "destructive";
  };

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <p className="text-sm text-muted-foreground">
          {lastSuccess
            ? t("last-backup", {
                date: formatDateTime(lastSuccess.created_at),
              })
            : t("last-backup", { date: t("never") })}
        </p>
        <Button size="sm" onClick={handleBackupNow} disabled={triggering}>
          {triggering && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("back-up-now")}
        </Button>
      </div>

      {/* Schedule config */}
      {settings && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t("schedule-enabled")}</p>
            <Switch
              checked={settings.backup_schedule_enabled}
              onCheckedChange={(v) =>
                onSettingsChange({
                  ...settings,
                  backup_schedule_enabled: v,
                })
              }
            />
          </div>
          {settings.backup_schedule_enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor="backup-interval">
                  {t("interval-hours")}
                </FieldLabel>
                <Input
                  id="backup-interval"
                  type="number"
                  min={1}
                  value={settings.backup_interval_hours}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      backup_interval_hours: Math.max(
                        1,
                        Number(e.target.value),
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <FieldLabel htmlFor="backup-retention">
                  {t("retention-count")}
                </FieldLabel>
                <Input
                  id="backup-retention"
                  type="number"
                  min={1}
                  value={settings.backup_retention_count}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      backup_retention_count: Math.max(
                        1,
                        Number(e.target.value),
                      ),
                    })
                  }
                />
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onSaveSettings}>
              {t("settings-saved")}
            </Button>
          </div>
        </div>
      )}

      {/* History table */}
      {backups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("no-backups")}
        </p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col-date")}</TableHead>
                <TableHead>{t("col-trigger")}</TableHead>
                <TableHead>{t("col-status")}</TableHead>
                <TableHead>{t("col-size")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">
                    {formatDateTime(b.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {b.trigger === "manual"
                        ? t("trigger-manual")
                        : t("trigger-scheduled")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(b.status)}>
                      {b.status === "running"
                        ? t("status-running")
                        : b.status === "success"
                          ? t("status-success")
                          : t("status-failed")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatFileSize(b.size_bytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === "success" && b.filename && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("download")}
                          aria-label={t("download")}
                          disabled={downloadingId === b.id}
                          onClick={() => handleDownload(b)}
                        >
                          {downloadingId === b.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t("delete")}
                        aria-label={t("delete")}
                        onClick={() => handleDelete(b.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
