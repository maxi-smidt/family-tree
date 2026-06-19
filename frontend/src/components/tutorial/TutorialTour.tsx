import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "@/components/tutorial/tutorial-driver.css";
import { useTranslation } from "react-i18next";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTreeStore } from "@/hooks/useTreeStore";

const CREATE_TREE_SELECTOR = '[data-tutorial="create-tree"]';
const CREATE_DIALOG_SELECTOR = '[data-tutorial="create-dialog"]';
const TREE_CREATE_BUTTON_SELECTOR = '[data-tutorial="tree-create-btn"]';
const ADD_MEMBER_SELECTOR = '[data-tutorial="add-member"]';
const SIDEBAR_SELECTOR = '[data-tutorial="sidebar"]';
const DESKTOP_TABS_SELECTOR = '[data-tutorial="views-tabs"]';
const MOBILE_TABS_SELECTOR = '[data-tutorial="views-tabs-mobile"]';
const NEW_TREE_SELECTOR = '[data-tutorial="new-tree"]';
const ADD_FRIEND_SELECTOR = '[data-tutorial="add-friend"]';

const ELEMENT_WAIT_MS = 10_000;
const TREE_CREATE_WAIT_MS = 30_000;

type TutorialDriver = ReturnType<typeof driver>;

function waitForElement(
  selector: string,
  timeoutMs = ELEMENT_WAIT_MS,
): Promise<HTMLElement> {
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    let timeoutId: number | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      observer.disconnect();
    };

    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;
      cleanup();
      resolve(element);
    });

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${selector}`));
    }, timeoutMs);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function waitForSelectedTree(timeoutMs = TREE_CREATE_WAIT_MS): Promise<void> {
  if (useTreeStore.getState().selectedTree) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    const timeoutId = window.setTimeout(() => {
      unsubscribe?.();
      reject(new Error("Timed out waiting for the created tree"));
    }, timeoutMs);

    unsubscribe = useTreeStore.subscribe((state) => {
      if (!state.selectedTree) return;
      window.clearTimeout(timeoutId);
      unsubscribe?.();
      resolve();
    });
  });
}

function currentTabsSelector() {
  return window.matchMedia("(max-width: 767px)").matches
    ? MOBILE_TABS_SELECTOR
    : DESKTOP_TABS_SELECTOR;
}

export const TutorialTour = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "tutorial" });
  const isRunning = useTutorialStore((s) => s.isRunning);
  const finish = useTutorialStore((s) => s.finish);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const setSidebarOpen = useFamilyTreeSettings((s) => s.setSidebarOpen);

  useEffect(() => {
    if (!isRunning) return;

    const hadTreeOnStart = useTreeStore.getState().selectedTree !== undefined;
    const sidebarOpenOnStart = useFamilyTreeSettings.getState().sidebarOpen;
    const tabsSelector = currentTabsSelector();
    let transitionPending = false;
    let restoredSidebar = false;
    let finished = false;

    const restoreSidebar = () => {
      if (restoredSidebar) return;
      restoredSidebar = true;
      setSidebarOpen(sidebarOpenOnStart);
    };

    const moveAfter = (
      d: TutorialDriver,
      direction: "next" | "previous",
      action: () => Promise<unknown>,
    ) => {
      if (transitionPending) return;
      transitionPending = true;
      void action()
        .then(() => {
          if (direction === "next") d.moveNext();
          else d.movePrevious();
        })
        .catch((error: unknown) => {
          console.warn("Tutorial step could not advance", error);
        })
        .finally(() => {
          transitionPending = false;
        });
    };

    navigateTo("tree-view");
    setSidebarOpen(false);

    const createTreeSteps: DriveStep[] = hadTreeOnStart
      ? []
      : [
          // Create-tree button (NoDatabasePlaceholder). Next opens the dialog
          // and advances only after the dialog has mounted.
          {
            element: CREATE_TREE_SELECTOR,
            popover: {
              title: t("create-tree.title"),
              description: t("create-tree.body"),
              side: "top",
              align: "center",
              onNextClick: (_, __, { driver: d }) => {
                const button =
                  document.querySelector<HTMLElement>(CREATE_TREE_SELECTOR);
                if (!button) return;
                button.click();
                moveAfter(d, "next", () =>
                  waitForElement(CREATE_DIALOG_SELECTOR).then(() => {
                    const nameInput =
                      document.querySelector<HTMLInputElement>("#databaseName");
                    nameInput?.focus();
                  }),
                );
              },
            },
          },

          // Tree-name dialog (whole dialog is the spotlight).
          {
            element: CREATE_DIALOG_SELECTOR,
            popover: {
              title: t("tree-name.title"),
              description: t("tree-name.body"),
              side: "right",
              align: "center",
              showButtons: ["next"],
              showProgress: false,
            },
          },

          // Create button inside dialog. Next clicks it and waits until the
          // tree store reports a selected tree, then waits for the tree UI.
          {
            element: TREE_CREATE_BUTTON_SELECTOR,
            popover: {
              title: t("tree-confirm.title"),
              description: t("tree-confirm.body"),
              side: "top",
              align: "end",
              showButtons: ["next"],
              showProgress: false,
              onNextClick: (_, __, { driver: d }) => {
                const button = document.querySelector<HTMLButtonElement>(
                  TREE_CREATE_BUTTON_SELECTOR,
                );
                if (!button || button.disabled) {
                  document
                    .querySelector<HTMLInputElement>("#databaseName")
                    ?.focus();
                  return;
                }

                button.click();
                moveAfter(d, "next", async () => {
                  await waitForSelectedTree();
                  await waitForElement(ADD_MEMBER_SELECTOR);
                });
              },
            },
          },
        ];

    const steps: DriveStep[] = [
      // 0 — Welcome
      {
        popover: {
          title: t("welcome.title"),
          description: t("welcome.body"),
        },
      },

      ...createTreeSteps,

      // Add a person (add-member button in MemberControls). Next opens the
      // sidebar, then advances after it is mounted.
      {
        element: ADD_MEMBER_SELECTOR,
        popover: {
          title: hadTreeOnStart
            ? t("existing-tree.title")
            : t("add-member.title"),
          description: hadTreeOnStart
            ? t("existing-tree.body")
            : t("add-member.body"),
          side: "left",
          align: "end",
          onNextClick: (_, __, { driver: d }) => {
            setSidebarOpen(true);
            moveAfter(d, "next", () => waitForElement(SIDEBAR_SELECTOR));
          },
          showButtons: hadTreeOnStart ? undefined : ["next"],
        },
      },

      // Sidebar overview
      {
        element: SIDEBAR_SELECTOR,
        popover: {
          title: t("sidebar-panel.title"),
          description: t("sidebar-panel.body"),
          side: "right",
          align: "center",
        },
      },

      // Tab bar; Next navigates to database-management.
      {
        element: tabsSelector,
        popover: {
          title: t("switch-views.title"),
          description: t("switch-views.body"),
          side: "bottom",
          align: "start",
          onNextClick: (_, __, { driver: d }) => {
            navigateTo("database-management-view");
            moveAfter(d, "next", () => waitForElement(NEW_TREE_SELECTOR));
          },
        },
      },

      // Tree management; Next navigates to friends, Back returns to tree.
      {
        element: NEW_TREE_SELECTOR,
        popover: {
          title: t("tree-management.title"),
          description: t("tree-management.body"),
          side: "bottom",
          align: "start",
          onNextClick: (_, __, { driver: d }) => {
            navigateTo("friends-view");
            moveAfter(d, "next", () => waitForElement(ADD_FRIEND_SELECTOR));
          },
          onPrevClick: (_, __, { driver: d }) => {
            navigateTo("tree-view");
            moveAfter(d, "previous", () => waitForElement(tabsSelector));
          },
        },
      },

      // Friends / Add-friend tab. Back returns to tree management.
      {
        element: ADD_FRIEND_SELECTOR,
        popover: {
          title: t("friends.title"),
          description: t("friends.body"),
          side: "bottom",
          align: "start",
          onPrevClick: (_, __, { driver: d }) => {
            navigateTo("database-management-view");
            moveAfter(d, "previous", () => waitForElement(NEW_TREE_SELECTOR));
          },
        },
      },

      // Done
      {
        popover: {
          title: t("finish.title"),
          description: t("finish.body"),
        },
      },
    ];

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
        restoreSidebar();
        finish();
      },
      onPopoverRender: (popover) => {
        const titleId = "tutorial-popover-title";
        const descriptionId = "tutorial-popover-description";

        popover.wrapper.setAttribute("role", "dialog");
        popover.wrapper.setAttribute("aria-live", "polite");
        popover.wrapper.setAttribute("aria-modal", "false");

        if (popover.title.textContent) {
          popover.title.id = titleId;
          popover.wrapper.setAttribute("aria-labelledby", titleId);
        }

        if (popover.description.textContent) {
          popover.description.id = descriptionId;
          popover.wrapper.setAttribute("aria-describedby", descriptionId);
        }

        popover.closeButton.setAttribute("aria-label", t("buttons.skip"));
      },
      steps,
    });

    driverObj.drive();

    return () => {
      finished = true;
      restoreSidebar();
      driverObj.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  return null;
};
