import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "@/components/tutorial/tutorial-driver.css";
import { useTranslation } from "react-i18next";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";

// Step indices (0-based) — used for moveTo() when skipping dialog steps.
const STEP_ADD_MEMBER = 4;

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

    // Guard: prevents onDestroyed from marking tour complete during React cleanup.
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
        // 0 — Welcome
        {
          popover: {
            title: t("welcome.title"),
            description: t("welcome.body"),
          },
        },

        // 1 — Create-tree button (NoDatabasePlaceholder)
        //     Weiter clicks the button; if element absent (user has a tree already)
        //     skip straight to the add-member step.
        {
          element: '[data-tutorial="create-tree"]',
          popover: {
            title: t("create-tree.title"),
            description: t("create-tree.body"),
            side: "top",
            align: "center",
            onNextClick: (_, __, { driver: d }) => {
              const btn = document.querySelector<HTMLElement>(
                '[data-tutorial="create-tree"]',
              );
              if (!btn) {
                d.moveTo(STEP_ADD_MEMBER);
                return;
              }
              btn.click();
              setTimeout(() => d.moveNext(), 400);
            },
          },
        },

        // 2 — Tree-name dialog (whole dialog is the spotlight)
        {
          element: '[data-tutorial="create-dialog"]',
          popover: {
            title: t("tree-name.title"),
            description: t("tree-name.body"),
            side: "right",
            align: "center",
          },
        },

        // 3 — Create button inside dialog
        //     Weiter clicks it; tree is created; wait for view transition.
        {
          element: '[data-tutorial="tree-create-btn"]',
          popover: {
            title: t("tree-confirm.title"),
            description: t("tree-confirm.body"),
            side: "top",
            align: "end",
            onNextClick: (_, __, { driver: d }) => {
              const btn = document.querySelector<HTMLElement>(
                '[data-tutorial="tree-create-btn"]',
              );
              btn?.click();
              // Wait for the API call + tree-view re-render before highlighting
              // the add-member button.
              setTimeout(() => d.moveNext(), 2500);
            },
          },
        },

        // 4 — Add a person (add-member button in MemberControls)
        //     Weiter opens the sidebar then advances.
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

        // 5 — Sidebar overview
        {
          element: '[data-tutorial="sidebar"]',
          popover: {
            title: t("sidebar-panel.title"),
            description: t("sidebar-panel.body"),
            side: "right",
            align: "center",
          },
        },

        // 6 — Tab bar; Weiter navigates to database-management
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

        // 7 — Tree management; Weiter navigates to friends
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

        // 8 — Friends / Add-friend tab
        {
          element: '[data-tutorial="add-friend"]',
          popover: {
            title: t("friends.title"),
            description: t("friends.body"),
            side: "bottom",
            align: "start",
          },
        },

        // 9 — Done
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
      finished = true;
      driverObj.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  return null;
};
