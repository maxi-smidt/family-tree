import { useEffect, useState } from "react";
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

// Startup is usually over in well under a second (an ordinary restart, or a
// dev server reloading after a code change), so poll briskly and only show
// the card once the wait is long enough to notice — a short restart then
// reads as the normal loading spinner instead of a 5 s "starting" screen.
const POLL_INTERVAL_MS = 1000;
const CARD_DELAY_MS = 1500;

/** Shown while the backend's database startup (#1020) has every ordinary
 *  route gated. Re-runs the auth check on an interval so the app leaves this
 *  screen the moment the backend opens back up — no action required from the
 *  user, and their session is never touched. */
export const MaintenanceScreen = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "maintenance" });
  const retryAuthCheck = useAuthStore((s) => s.retryAuthCheck);
  const [showCard, setShowCard] = useState(false);

  useEffect(() => {
    void retryAuthCheck();
    const id = setInterval(() => void retryAuthCheck(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [retryAuthCheck]);

  useEffect(() => {
    const id = setTimeout(() => setShowCard(true), CARD_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  if (!showCard) {
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

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
