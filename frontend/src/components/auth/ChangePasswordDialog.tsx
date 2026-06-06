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
import { api } from "@/services/api";
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

  const handleSave = async () => {
    try {
      await api.post("/auth/password", {
        current_password: current,
        new_password: next,
      });
      toast.success(t("success"));
      setCurrent("");
      setNext("");
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="new-password">{t("new")}</FieldLabel>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!current || !next}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
