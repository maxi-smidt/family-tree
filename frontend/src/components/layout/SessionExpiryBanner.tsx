import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";
import { useAuthStore } from "@/hooks/useAuthStore";

export function SessionExpiryBanner() {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.session" });
  const sessionExpiringSoon = useAuthStore((s) => s.sessionExpiringSoon);
  const sessionRefreshFailed = useAuthStore((s) => s.sessionRefreshFailed);
  const requireRelogin = useAuthStore((s) => s.requireRelogin);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!sessionExpiringSoon || sessionRefreshFailed) setDismissed(false);
  }, [sessionExpiringSoon, sessionRefreshFailed]);

  if (!sessionExpiringSoon || dismissed) return null;

  return (
    <Alert
      variant="destructive"
      className="rounded-none border-x-0 border-t-0 pl-16"
    >
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{t("expiring-title")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {sessionRefreshFailed
            ? t("refresh-failed-description")
            : t("expiring-description")}
        </span>
        <span className="flex shrink-0 gap-2">
          {sessionRefreshFailed && (
            <Button variant="outline" size="sm" onClick={requireRelogin}>
              {t("refresh-failed-relogin")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDismissed(true)}
          >
            {t("expiring-dismiss")}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
