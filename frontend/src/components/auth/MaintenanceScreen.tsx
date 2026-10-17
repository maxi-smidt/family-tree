import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/hooks/useAuthStore";
import {
  MigrationStatus,
  SystemStatusService,
} from "@/services/SystemStatusService";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const POLL_INTERVAL_MS = 5000;

/** Shown while the backend's startup migration (#1020) has every ordinary
 *  route gated. Polls the unauthenticated /health/migration status to show
 *  progress, and re-runs the auth check on the same interval so the app
 *  leaves this screen the moment the backend opens back up — no action
 *  required from the user, and their session is never touched. */
export const MaintenanceScreen = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "maintenance" });
  const retryAuthCheck = useAuthStore((s) => s.retryAuthCheck);
  const [migration, setMigration] = useState<MigrationStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await SystemStatusService.getMigrationStatus();
        if (!cancelled) setMigration(status);
      } catch {
        // /health/migration is best-effort for display only; a transient
        // failure here just leaves the last-known phase on screen.
      }
      await retryAuthCheck();
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [retryAuthCheck]);

  const phase = migration?.status ?? "preflight";
  const failed = phase === "failed";

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {failed ? t("failed-description") : t(`phase.${phase}`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          {failed ? null : <Spinner className="size-6" />}
          {!failed && migration && (
            <p className="text-sm text-muted-foreground">
              {t("step", {
                current: migration.phase_index + 1,
                total: migration.phase_count,
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
