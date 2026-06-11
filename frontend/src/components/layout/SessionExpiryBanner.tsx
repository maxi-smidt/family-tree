import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";
import { useAuthStore } from "@/hooks/useAuthStore";

export function SessionExpiryBanner() {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.session" });
  const sessionExpiringSoon = useAuthStore((s) => s.sessionExpiringSoon);
  const [dismissed, setDismissed] = useState(false);

  if (!sessionExpiringSoon || dismissed) return null;

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{t("expiring-title")}</AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>{t("expiring-description")}</span>
        <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
          {t("expiring-dismiss")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
