import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/hooks/useAuthStore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const POLL_INTERVAL_MS = 5000;

/** Shown while the backend's database startup (#1020) has every ordinary
 *  route gated. Re-runs the auth check on an interval so the app leaves this
 *  screen the moment the backend opens back up — no action required from the
 *  user, and their session is never touched. */
export const MaintenanceScreen = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "maintenance" });
  const retryAuthCheck = useAuthStore((s) => s.retryAuthCheck);

  useEffect(() => {
    void retryAuthCheck();
    const id = setInterval(() => void retryAuthCheck(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [retryAuthCheck]);

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Spinner className="size-6" />
        </CardContent>
      </Card>
    </div>
  );
};
