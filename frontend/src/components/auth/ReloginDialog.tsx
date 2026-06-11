import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { toast } from "sonner";
import { useAuthStore } from "@/hooks/useAuthStore";

export const ReloginDialog = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.session" });
  const reloginRequired = useAuthStore((s) => s.reloginRequired);
  const user = useAuthStore((s) => s.user);
  const config = useAuthStore((s) => s.config);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const isAuthentik =
    user?.auth_provider !== "local" &&
    config?.authentik_enabled &&
    config.authentik_login_url;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.username || !password) return;
    setLoading(true);
    try {
      await login(user.username, password);
      setPassword("");
    } catch (err) {
      console.error(err);
      toast.error(t("relogin-error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={reloginRequired}
      onOpenChange={() => {
        /* non-dismissable — user must re-auth or log out */
      }}
    >
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("relogin-title")}</DialogTitle>
          <DialogDescription>{t("relogin-description")}</DialogDescription>
        </DialogHeader>

        {isAuthentik ? (
          <div className="py-2">
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = config!.authentik_login_url!;
              }}
            >
              {t("relogin-submit")}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
            <div className="space-y-2">
              <FieldLabel htmlFor="relogin-username">
                {user?.username ?? ""}
              </FieldLabel>
              <Input
                id="relogin-username"
                value={user?.username ?? ""}
                disabled
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="relogin-password">
                {t("relogin-password")}
              </FieldLabel>
              <Input
                id="relogin-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={logout}
              >
                {t("relogin-cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={loading || !password}
              >
                {t("relogin-submit")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {isAuthentik && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={logout}>
              {t("relogin-cancel")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
