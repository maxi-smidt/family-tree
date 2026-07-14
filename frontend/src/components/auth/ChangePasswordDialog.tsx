import { useState } from "react";
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
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const ChangePasswordDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "auth.change-password",
  });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const changePassword = useAuthStore((s) => s.changePassword);
  const isSaving = useAuthStore((s) => s.accountOperation === "changing-password");

  const resetFields = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  const handleSave = async () => {
    if (next !== confirm) {
      toast.error(t("mismatch"));
      return;
    }
    try {
      await changePassword(current, next);
      toast.success(t("success"));
      resetFields();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="current-password">{t("current")}</FieldLabel>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="new-password">{t("new")}</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="confirm-password">{t("confirm")}</FieldLabel>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!current || !next || !confirm || isSaving}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
