import { FormEvent, useState } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ApiError, api, setAuthToken } from "@/services/api";
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

export const LoginPage = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.login" });
  const config = useAuthStore((s) => s.config);
  const login = useAuthStore((s) => s.login);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
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
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        err.message === "account_pending_deletion"
      ) {
        toast.error(t("account-pending-deletion"), { duration: 10000 });
      } else {
        toast.error(
          mode === "register" ? t("register-error") : t("login-error"),
        );
      }
    } finally {
      setLoading(false);
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
