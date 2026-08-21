import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/hooks/useAuthStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/** Shown after the startup /auth/me check fails transiently (network error or
 *  5xx) — the session credential is retained, so the user can retry instead
 *  of being dropped back to the login screen. */
export const AuthUnreachableScreen = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.session" });
  const retryAuthCheck = useAuthStore((s) => s.retryAuthCheck);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryAuthCheck();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("unreachable-title")}</CardTitle>
          <CardDescription>{t("unreachable-description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            onClick={() => void handleRetry()}
            disabled={retrying}
          >
            {retrying ? <Spinner className="size-4" /> : t("unreachable-retry")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
