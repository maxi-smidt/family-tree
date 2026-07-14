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
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useWhatsNewStore } from "@/hooks/useWhatsNewStore";
import { APP_VERSION } from "@/lib/buildInfo";

export function WhatsNewAnnouncementDialog() {
  const { t } = useTranslation(undefined, { keyPrefix: "whats-new" });
  const lastReadVersion = useWhatsNewStore((s) => s.lastReadVersion);
  const loaded = useWhatsNewStore((s) => s.loaded);
  const dismissed = useWhatsNewStore((s) => s.dismissed);
  const markAsRead = useWhatsNewStore((s) => s.markAsRead);
  const tutorialLoaded = useTutorialStore((s) => s.loaded);
  const tutorialCompleted = useTutorialStore((s) => s.completed);
  const user = useAuthStore((s) => s.user);
  const openSettings = useUserSettingsViewStore((s) => s.openSettings);
  const legalGateOpen =
    !!user?.legal_acceptance_required && !user?.legal_accepted;
  const open =
    loaded &&
    tutorialLoaded &&
    tutorialCompleted &&
    !dismissed &&
    !legalGateOpen &&
    lastReadVersion !== APP_VERSION;

  const handleOpenChangelog = () => {
    void markAsRead();
    openSettings("changelog");
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && void markAsRead()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { version: APP_VERSION })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleOpenChangelog}>
            {t("view-changelog")}
          </Button>
          <Button onClick={() => void markAsRead()}>{t("dismiss")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
