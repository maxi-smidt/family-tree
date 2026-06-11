import { FormEvent, useState } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { api, ApiError, setAuthToken } from "@/services/api";
import { authErrorToast } from "@/components/auth/loginError";
import { TokenResponse } from "@/types/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const ADMIN_INITIATED_DELETION = "admin_initiated_deletion";

export const LoginPage = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.login" });
  const config = useAuthStore((s) => s.config);
  const login = useAuthStore((s) => s.login);
  const restoreAccount = useAuthStore((s) => s.restoreAccount);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPendingDeletion(false);
    try {
      if (mode === "register") {
        const res = await api.post<TokenResponse>("/auth/register", {
          username,
          password,
          email: email || null,
        });
        setAuthToken(res.access_token);
        useAuthStore.setState({ user: res.user, status: "authenticated" });
      } else {
        await login(username, password);
      }
    } catch (err) {
      console.error(err);
      const { key, duration } = authErrorToast(err, mode);
      toast.error(t(key), duration ? { duration } : undefined);
      if (key === "account-pending-deletion") {
        setPendingDeletion(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoreLoading(true);
    try {
      await restoreAccount(username, password);
    } catch (err) {
      console.error(err);
      const isAdminDeletion =
        err instanceof ApiError && err.message === ADMIN_INITIATED_DELETION;
      toast.error(
        isAdminDeletion ? t("restore-admin-deletion") : t("restore-error"),
        { duration: 8000 },
      );
    } finally {
      setRestoreLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {mode === "register" ? t("register-subtitle") : t("subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="username">{t("username")}</FieldLabel>
              <Input
                id="username"
                value={username}
                autoFocus
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            {mode === "register" && (
              <div className="space-y-2">
                <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !username || !password}
            >
              {mode === "register" ? t("register") : t("sign-in")}
            </Button>
          </form>

          {config?.authentik_enabled && config.authentik_login_url && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = config.authentik_login_url!;
              }}
            >
              {t("sign-in-authentik")}
            </Button>
          )}

          {mode === "login" && pendingDeletion && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="text-foreground">{t("restore-description")}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={restoreLoading}
                onClick={() => void handleRestore()}
              >
                {t("restore-button")}
              </Button>
            </div>
          )}

          {config?.allow_self_registration && (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login"
                ? t("switch-to-register")
                : t("switch-to-login")}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
