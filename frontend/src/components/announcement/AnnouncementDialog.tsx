import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { useAnnouncementStore } from "@/hooks/useAnnouncementStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { isNewerVersion } from "@/utils/version";

export function AnnouncementDialog() {
  const { t } = useTranslation(undefined, { keyPrefix: "announcement" });

  const announcement = useAnnouncementStore((s) => s.announcement);
  const announcementLoaded = useAnnouncementStore((s) => s.loaded);
  const dismissed = useAnnouncementStore((s) => s.dismissed);
  const acknowledge = useAnnouncementStore((s) => s.acknowledge);

  const tutorialLoaded = useTutorialStore((s) => s.loaded);
  const tutorialCompleted = useTutorialStore((s) => s.completed);

  // The legal acceptance gate takes priority: never show the announcement
  // popup underneath/alongside the blocking legal dialog.
  const user = useAuthStore((s) => s.user);
  const legalGateOpen =
    !!user?.legal_acceptance_required && !user?.legal_accepted;

  const hasContent =
    announcement !== null &&
    (announcement.body.trim() !== "" || announcement.title.trim() !== "");

  const open =
    hasContent &&
    tutorialLoaded &&
    tutorialCompleted &&
    announcementLoaded &&
    !dismissed &&
    !legalGateOpen &&
    isNewerVersion(announcement!.version, announcement!.acknowledged_version);

  const displayTitle =
    announcement?.title.trim() || (hasContent ? t("default-title") : "");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && acknowledge()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{displayTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {announcement && <MarkdownContent content={announcement.body} />}
        </div>
        <DialogFooter>
          <Button onClick={acknowledge}>{t("dismiss")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
