import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { api } from "@/services/api";
import { useAuthStore } from "@/hooks/useAuthStore";
import { TotpSetupResponse } from "@/types/user";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";

type Step = "idle" | "setup" | "verify" | "recovery" | "disable";

export function TwoFactorPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.two-factor" });
  const user = useAuthStore((s) => s.user);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const totpEnabled = user?.totp_enabled ?? false;

  const reset = () => {
    setStep("idle");
    setSetup(null);
    setQrDataUrl(null);
    setCode("");
    setDisablePassword("");
    setDisableCode("");
    setLoading(false);
    setCopiedSecret(false);
    setCopiedCodes(false);
  };

  useEffect(() => {
    if (step === "verify" || step === "disable") {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, [step]);

  const handleSetup = async () => {
    setLoading(true);
    try {
      const res = await api.post<TotpSetupResponse>("/auth/2fa/setup");
      setSetup(res);
      const qr = await api.get<{ data_url: string }>("/auth/2fa/qr-code");
      setQrDataUrl(qr.data_url);
      setStep("setup");
    } catch {
      toast.error(t("setup-error"));
    } finally {
      setLoading(false);
    }
  };

  const handleEnable = async () => {
    if (!code) return;
    setLoading(true);
    try {
      await api.post("/auth/2fa/enable", { code });
      await refreshMe();
      setStep("recovery");
      toast.success(t("enabled-success"));
    } catch {
      toast.error(t("enable-error"));
      setCode("");
      setTimeout(() => codeInputRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      await api.post("/auth/2fa/disable", {
        password: disablePassword,
        code: disableCode,
      });
      await refreshMe();
      toast.success(t("disabled-success"));
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Incorrect password") {
        toast.error(t("disable-wrong-password"));
      } else {
        toast.error(t("disable-error"));
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: "secret" | "codes") => {
    await navigator.clipboard.writeText(text);
    if (type === "secret") {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }
  };

  return (
    <div className="space-y-4 max-w-md">
      {/* Idle: show current status */}
      {step === "idle" && (
        <>
          <div>
            <p className="font-medium text-sm">{t("title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totpEnabled
                ? t("description-enabled")
                : t("description-disabled")}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {totpEnabled ? t("status-enabled") : t("status-disabled")}
          </p>
          {totpEnabled ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setStep("disable")}
            >
              {t("disable-btn")}
            </Button>
          ) : (
            <Button size="sm" disabled={loading} onClick={handleSetup}>
              {t("setup-btn")}
            </Button>
          )}
        </>
      )}

      {/* Setup: show QR code + secret */}
      {step === "setup" && setup && (
        <>
          <div>
            <p className="font-medium text-sm">{t("setup-title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("setup-description")}
            </p>
          </div>
          <div className="space-y-4">
            {qrDataUrl && (
              <div className="flex justify-center">
                <img
                  src={qrDataUrl}
                  alt="QR code"
                  className="rounded border"
                  width={200}
                  height={200}
                />
              </div>
            )}
            <div className="space-y-1">
              <FieldLabel>{t("manual-key")}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={setup.secret}
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(setup.secret, "secret")}
                >
                  {copiedSecret ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={() => setStep("verify")}>
              {t("next")}
            </Button>
          </div>
        </>
      )}

      {/* Verify: enter first TOTP code to activate */}
      {step === "verify" && (
        <>
          <div>
            <p className="font-medium text-sm">{t("verify-title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("verify-description")}
            </p>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="totp-enable-code">
              {t("code-label")}
            </FieldLabel>
            <Input
              id="totp-enable-code"
              ref={codeInputRef}
              value={code}
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="000000"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleEnable()}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep("setup")}
            >
              {t("back")}
            </Button>
            <Button
              size="sm"
              disabled={loading || !code}
              onClick={handleEnable}
            >
              {t("enable-btn")}
            </Button>
          </div>
        </>
      )}

      {/* Recovery: show backup codes after enabling */}
      {step === "recovery" && setup && (
        <>
          <div>
            <p className="font-medium text-sm">{t("recovery-title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("recovery-description")}
            </p>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-3">
              {setup.recovery_codes.map((c) => (
                <code key={c} className="text-xs font-mono text-center">
                  {c}
                </code>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                copyToClipboard(setup.recovery_codes.join("\n"), "codes")
              }
            >
              {copiedCodes ? (
                <Check className="mr-2 h-4 w-4 text-green-500" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {t("copy-codes")}
            </Button>
          </div>
          <Button size="sm" onClick={reset}>
            {t("done")}
          </Button>
        </>
      )}

      {/* Disable: confirm with password + TOTP code */}
      {step === "disable" && (
        <>
          <div>
            <p className="font-medium text-sm">{t("disable-title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("disable-description")}
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="disable-password">
                {t("disable-password")}
              </FieldLabel>
              <Input
                id="disable-password"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="disable-code">{t("code-label")}</FieldLabel>
              <Input
                id="disable-code"
                ref={codeInputRef}
                value={disableCode}
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                onChange={(e) => setDisableCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleDisable()}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep("idle")}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={loading || !disablePassword || !disableCode}
              onClick={handleDisable}
            >
              {t("disable-confirm")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
