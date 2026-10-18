import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Shown when this frontend build and the backend it's talking to declare a
 *  different wire-contract epoch (#1012) — a stale cached tab after a server
 *  upgrade, or (more rarely) a rollback. Reloading picks up whichever side
 *  changed; there is nothing safe to retry in place. */
export const AppUpgradeRequiredScreen = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "app-upgrade" });

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            onClick={() => window.location.reload()}
          >
            {t("reload")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
