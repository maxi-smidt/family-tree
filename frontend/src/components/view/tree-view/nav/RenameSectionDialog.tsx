import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSectionStore } from "@/hooks/useSectionStore";
import { SectionDB } from "@/types/section";
import { ApiError } from "@/services/api";

interface RenameSectionDialogProps {
  section: SectionDB | null;
  onOpenChange: (open: boolean) => void;
}

export const RenameSectionDialog = ({
  section,
  onOpenChange,
}: RenameSectionDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.rename-section",
  });
  const updateSection = useSectionStore((s) => s.updateSection);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(section?.name ?? "");
    setError(null);
  }, [section]);

  const handleSubmit = async () => {
    if (!section) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === section.name) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateSection(section.id, { name: trimmed });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("name-conflict")
          : t("rename-error"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={section !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || submitting}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
