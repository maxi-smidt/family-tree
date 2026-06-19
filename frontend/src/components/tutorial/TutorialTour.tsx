import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "@/components/tutorial/tutorial-driver.css";
import { useTranslation } from "react-i18next";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";

export const TutorialTour = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "tutorial" });
  const isRunning = useTutorialStore((s) => s.isRunning);
  const finish = useTutorialStore((s) => s.finish);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const setSidebarOpen = useFamilyTreeSettings((s) => s.setSidebarOpen);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  useEffect(() => {
    if (!isRunning) return;

    navigateTo("tree-view");
    setSidebarOpen(false);

    // Guard against onDestroyed firing during React effect cleanup.
    let finished = false;

    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: false,
      showButtons: ["next", "previous"],
      nextBtnText: t("buttons.next"),
      prevBtnText: t("buttons.prev"),
      doneBtnText: t("buttons.done"),
      onDestroyed: () => {
        if (finished) return;
        finished = true;
        finish();
      },
      steps: [
        // 1 — Welcome
        {
          popover: {
            title: t("welcome.title"),
            description: t("welcome.body"),
          },
        },
        // 2 — Create first tree (NoDatabasePlaceholder button)
        {
          element: '[data-tutorial="create-tree"]',
          popover: {
            title: t("create-tree.title"),
            description: t("create-tree.body"),
            side: "top",
            align: "center",
          },
        },
        // 3 — Add a person; on Next: open sidebar then advance
        {
          element: '[data-tutorial="add-member"]',
          popover: {
            title: t("add-member.title"),
            description: t("add-member.body"),
            side: "left",
            align: "end",
            onNextClick: (_, __, { driver: d }) => {
              setSidebarOpen(true);
              setTimeout(() => d.moveNext(), 350);
            },
          },
        },
        // 4 — Sidebar (tree switcher, settings, user menu)
        {
          element: '[data-tutorial="sidebar"]',
          popover: {
            title: t("sidebar-panel.title"),
            description: t("sidebar-panel.body"),
            side: "right",
            align: "center",
          },
        },
        // 5 — Tab bar; on Next: navigate to tree management
        {
          element: '[data-tutorial="views-tabs"]',
          popover: {
            title: t("switch-views.title"),
            description: t("switch-views.body"),
            side: "bottom",
            align: "start",
            onNextClick: (_, __, { driver: d }) => {
              navigateTo("database-management-view");
              setTimeout(() => d.moveNext(), 500);
            },
          },
        },
        // 6 — Tree management (New button); on Next: navigate to friends
        {
          element: '[data-tutorial="new-tree"]',
          popover: {
            title: t("tree-management.title"),
            description: t("tree-management.body"),
            side: "bottom",
            align: "start",
            onNextClick: (_, __, { driver: d }) => {
              navigateTo("friends-view");
              setTimeout(() => d.moveNext(), 500);
            },
          },
        },
        // 7 — Friends / Add friend tab
        {
          element: '[data-tutorial="add-friend"]',
          popover: {
            title: t("friends.title"),
            description: t("friends.body"),
            side: "bottom",
            align: "start",
          },
        },
        // 8 — Done
        {
          popover: {
            title: t("finish.title"),
            description: t("finish.body"),
          },
        },
      ],
    });

    driverRef.current = driverObj;
    driverObj.drive();

    return () => {
      finished = true; // Prevent onDestroyed from marking tour complete on unmount
      driverObj.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  return null;
};
