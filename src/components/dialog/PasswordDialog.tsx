import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = {
  isOpen: boolean;
  mode: "export" | "import";
  onConfirm: (password: string | null) => void;
  onCancel: () => void;
};

export const PasswordDialog = ({
  isOpen,
  mode,
  onConfirm,
  onCancel,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.password",
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setConfirmPassword("");
      setError("");
      setShowPassword(false);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    // Validate password
    if (!password) {
      setError(t("error.empty"));
      return;
    }

    if (mode === "export") {
      // For export, require minimum length and confirmation
      if (password.length < 8) {
        setError(t("error.tooShort"));
        return;
      }

      if (password !== confirmPassword) {
        setError(t("error.noMatch"));
        return;
      }
    }

    onConfirm(password);
  };

  const handleSkip = () => {
    onConfirm(null);
  };

  const handleClose = () => {
    onCancel();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "export" ? t("title.export") : t("title.import")}
          </DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? t("description.export")
              : t("description.import")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="password">{t("label.password")}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder={t("placeholder.password")}
                autoFocus
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {mode === "export" && (
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t("label.confirmPassword")}
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                placeholder={t("placeholder.confirmPassword")}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {mode === "export" && (
            <p className="text-xs text-muted-foreground">
              {t("hint.minLength")}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={handleClose}>
              {t("button.cancel")}
            </Button>
          </DialogClose>
          {mode === "export" && (
            <Button variant="secondary" size="sm" onClick={handleSkip}>
              {t("button.skip")}
            </Button>
          )}
          <Button variant="default" size="sm" onClick={handleConfirm}>
            {t("button.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
