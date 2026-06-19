import { useEffect, useRef } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useTranslation } from "react-i18next";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useFeature } from "@/hooks/useAuthStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";

export const TutorialTour = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "tutorial" });
  const isRunning = useTutorialStore((s) => s.isRunning);
  const finish = useTutorialStore((s) => s.finish);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const gedcomEnabled = useFeature("gedcom");
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  useEffect(() => {
    if (!isRunning) return;

    // Navigate to tree view so the anchored steps are in the DOM
    navigateTo("tree-view");

    const steps: DriveStep[] = [
      {
        popover: {
          title: t("welcome.title"),
          description: t("welcome.body"),
        },
      },
      {
        element: '[data-tutorial="add-member"]',
        popover: {
          title: t("add-member.title"),
          description: t("add-member.body"),
          side: "left",
          align: "center",
        },
      },
      {
        element: '[data-tutorial="views-tabs"]',
        popover: {
          title: t("switch-views.title"),
          description: t("switch-views.body"),
          side: "bottom",
          align: "start",
        },
      },
      {
        popover: {
          title: t("manage-trees.title"),
          description: t("manage-trees.body"),
          onNextClick: () => {
            navigateTo("database-management-view");
            driverRef.current?.moveNext();
          },
        },
      },
      ...(gedcomEnabled
        ? [
            {
              element: '[data-tutorial="import-menu"]',
              popover: {
                title: t("import-gedcom.title"),
                description: t("import-gedcom.body"),
                side: "bottom" as const,
                align: "end" as const,
              },
            },
          ]
        : []),
      {
        popover: {
          title: t("finish.title"),
          description: t("finish.body"),
        },
      },
    ];

    let skipped = false;

    const driverObj = driver({
      showProgress: true,
      animate: true,
      steps,
      nextBtnText: t("buttons.next"),
      prevBtnText: t("buttons.prev"),
      doneBtnText: t("buttons.done"),
      onCloseClick: (_, __, { driver: d }) => {
        skipped = true;
        d.destroy();
      },
      onDestroyed: () => {
        finish({ skipped });
      },
    });

    driverRef.current = driverObj;
    driverObj.drive();

    return () => {
      driverObj.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  return null;
};
