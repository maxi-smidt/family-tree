import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { useAuthStore } from "@/hooks/useAuthStore";
import { TotpSetupResponse } from "@/types/user";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type Step = "idle" | "setup" | "verify" | "recovery" | "disable";

export const TwoFactorDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.two-factor" });
  const user = useAuthStore((s) => s.user);
  const setupTwoFactor = useAuthStore((s) => s.setupTwoFactor);
  const enableTwoFactor = useAuthStore((s) => s.enableTwoFactor);
  const disableTwoFactor = useAuthStore((s) => s.disableTwoFactor);
  const loading = useAuthStore((s) => s.accountOperation !== "idle");

  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
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
    setCopiedSecret(false);
    setCopiedCodes(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (step === "verify" || step === "disable") {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, [step]);

  const handleSetup = async () => {
    try {
      const result = await setupTwoFactor();
      setSetup(result.setup);
      setQrDataUrl(result.qrDataUrl);
      setStep("setup");
    } catch {
      toast.error(t("setup-error"));
    }
  };

  const handleEnable = async () => {
    if (!code) return;
    try {
      await enableTwoFactor(code);
      setStep("recovery");
      toast.success(t("enabled-success"));
    } catch {
      toast.error(t("enable-error"));
      setCode("");
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  };

  const handleDisable = async () => {
    try {
      await disableTwoFactor(disablePassword, disableCode);
      toast.success(t("disabled-success"));
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Incorrect password") {
        toast.error(t("disable-wrong-password"));
      } else {
        toast.error(t("disable-error"));
      }
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        {/* Idle: show current status */}
        {step === "idle" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>
                {totpEnabled ? t("description-enabled") : t("description-disabled")}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <p className="text-sm text-muted-foreground">
                {totpEnabled ? t("status-enabled") : t("status-disabled")}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t("cancel")}
              </Button>
              {totpEnabled ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setStep("disable")}
                >
                  {t("disable-btn")}
                </Button>
              ) : (
                <Button size="sm" disabled={loading} onClick={handleSetup}>
                  {t("setup-btn")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* Setup: show QR code URI + secret */}
        {step === "setup" && setup && (
          <>
            <DialogHeader>
              <DialogTitle>{t("setup-title")}</DialogTitle>
              <DialogDescription>{t("setup-description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
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
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={() => setStep("verify")}>
                {t("next")}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Verify: enter first TOTP code to activate */}
        {step === "verify" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("verify-title")}</DialogTitle>
              <DialogDescription>{t("verify-description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <FieldLabel htmlFor="totp-enable-code">{t("code-label")}</FieldLabel>
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
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setStep("setup")}>
                {t("back")}
              </Button>
              <Button size="sm" disabled={loading || !code} onClick={handleEnable}>
                {t("enable-btn")}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Recovery: show backup codes after enable */}
        {step === "recovery" && setup && (
          <>
            <DialogHeader>
              <DialogTitle>{t("recovery-title")}</DialogTitle>
              <DialogDescription>{t("recovery-description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
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
            <DialogFooter>
              <Button size="sm" onClick={handleClose}>
                {t("done")}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Disable: confirm with password + TOTP code */}
        {step === "disable" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("disable-title")}</DialogTitle>
              <DialogDescription>{t("disable-description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <FieldLabel htmlFor="disable-password">{t("disable-password")}</FieldLabel>
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
                  onKeyDown={(e) =>
                    e.key === "Enter" && void handleDisable()
                  }
                />
              </div>
            </div>
            <DialogFooter>
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
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
