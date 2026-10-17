import { FormEvent, ReactNode, useRef, useState } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ApiError } from "@/services/api";
import { authErrorToast } from "@/components/auth/loginError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LegalDocsDialog } from "@/components/legal/LegalDocsDialog";
import { toast } from "sonner";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";

const ADMIN_INITIATED_DELETION = "admin_initiated_deletion";

export const LoginPage = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.login" });
  const { t: tLegal } = useTranslation(undefined, { keyPrefix: "legal" });
  const config = useAuthStore((s) => s.config);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const verifyTotp = useAuthStore((s) => s.verifyTotp);
  const cancelTotp = useAuthStore((s) => s.cancelTotp);
  const totpRequired = useAuthStore((s) => s.totpRequired);
  const restoreAccount = useAuthStore((s) => s.restoreAccount);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);

  // TOTP step
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPendingDeletion(false);
    try {
      if (mode === "register") {
        await register(username, password, email || null);
      } else {
        await login(username, password);
        // If TOTP is required the store sets totpRequired=true; focus the code input.
        setTimeout(() => totpInputRef.current?.focus(), 50);
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

  const handleTotpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTotpLoading(true);
    try {
      await verifyTotp(totpCode.trim());
    } catch (err) {
      console.error(err);
      const isRateLimit = err instanceof ApiError && err.status === 429;
      toast.error(
        isRateLimit ? t("rate-limit-error") : t("totp-error"),
        isRateLimit ? { duration: 8000 } : undefined,
      );
      setTotpCode("");
      setTimeout(() => totpInputRef.current?.focus(), 50);
    } finally {
      setTotpLoading(false);
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

  if (totpRequired) {
    return (
      <AuthShell appName={t("title")}>
        <Card className="w-full max-w-sm gap-5 rounded-2xl px-2 py-8 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl font-bold tracking-tight">
              {t("totp-title")}
            </CardTitle>
            <CardDescription>{t("totp-subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="space-y-2">
                <FieldLabel htmlFor="totp-code">{t("totp-code")}</FieldLabel>
                <Input
                  id="totp-code"
                  ref={totpInputRef}
                  value={totpCode}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="000000"
                  onChange={(e) => setTotpCode(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={totpLoading || !totpCode}
              >
                {t("totp-verify")}
              </Button>
            </form>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
              onClick={() => {
                cancelTotp();
                setTotpCode("");
              }}
            >
              {t("totp-back")}
            </button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell appName={t("title")}>
      <Card className="w-full max-w-sm gap-5 rounded-2xl px-2 py-8 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {mode === "register" ? t("register-title") : t("welcome")}
          </CardTitle>
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
              <PasswordInput
                id="password"
                value={password}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || !username || !password}
            >
              {mode === "register" ? t("register") : t("sign-in")}
            </Button>
          </form>

          {config?.authentik_enabled && config.authentik_login_url && (
            <Button
              variant="outline"
              size="lg"
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
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => setLegalDocsOpen(true)}
        >
          {tLegal("legal-link-public")}
        </button>
        <span aria-hidden="true">·</span>
        <LanguageSwitch />
      </div>
      <LegalDocsDialog
        open={legalDocsOpen}
        onOpenChange={setLegalDocsOpen}
        showTerms={false}
      />
    </AuthShell>
  );
};

/** Offers the other UI language, named in that language ("Deutsch"). */
const LanguageSwitch = () => {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage === "de" ? "de" : "en";
  const other = current === "de" ? "en" : "de";
  return (
    <button
      type="button"
      lang={other}
      className="hover:text-foreground"
      onClick={() => void i18n.changeLanguage(other)}
    >
      {i18n.t(other === "de" ? "common.german" : "common.english", {
        lng: other,
      })}
    </button>
  );
};

/** Centred sign-in layout: app mark above a single card on the warm page. */
const AuthShell = ({
  appName,
  children,
}: {
  appName: string;
  children: ReactNode;
}) => (
  <div className="flex min-h-screen w-full flex-col items-center justify-center gap-7 bg-background p-4">
    <div className="flex flex-col items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-[13px] bg-primary text-2xl font-bold text-primary-foreground"
      >
        <Network className="size-6" strokeWidth={2} />
      </span>
      <span className="text-[15px] font-semibold text-muted-foreground">
        {appName}
      </span>
    </div>
    {children}
  </div>
);
