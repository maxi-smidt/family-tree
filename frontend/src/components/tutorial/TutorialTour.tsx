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
const TREE_NAME_INPUT_SELECTOR = "#databaseName";
const ADD_MEMBER_SELECTOR = '[data-tutorial="add-member"]';
const SIDEBAR_SELECTOR = '[data-tutorial="sidebar"]';
const DESKTOP_TABS_SELECTOR = '[data-tutorial="views-tabs"]';
const MOBILE_TABS_SELECTOR = '[data-tutorial="views-tabs-mobile"]';
const NEW_TREE_SELECTOR = '[data-tutorial="new-tree"]';
const ADD_FRIEND_SELECTOR = '[data-tutorial="add-friend"]';

const ELEMENT_WAIT_MS = 10_000;
const TREE_CREATE_WAIT_MS = 30_000;
// Re-measure the spotlight after these delays so highlights settle once dialogs,
// the sidebar, or a view transition have finished animating.
const SETTLE_REFRESH_DELAYS_MS = [120, 280, 460];

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

// Set a controlled <input>'s value so React's onChange fires. The tour drives
// the create flow itself (interaction with the spotlight is disabled), so we
// seed a default tree name programmatically rather than asking the user to type.
function setReactInputValue(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

    // --- Spotlight re-positioning -----------------------------------------
    // driver.js measures the target once per step, but dialogs, the sidebar
    // and view transitions animate afterwards, leaving the highlight at a stale
    // position. Re-measure on the next frame, after the animation settles, and
    // whenever the active element resizes/moves.
    let pendingRaf = 0;
    let activeObserver: ResizeObserver | undefined;
    const settleTimers: number[] = [];

    const clearSettleTimers = () => {
      settleTimers.forEach((id) => window.clearTimeout(id));
      settleTimers.length = 0;
    };

    const scheduleReposition = (d: TutorialDriver) => {
      if (pendingRaf) return;
      pendingRaf = window.requestAnimationFrame(() => {
        pendingRaf = 0;
        if (d.isActive()) d.refresh();
      });
    };

    // --- Reversible step transitions --------------------------------------
    // Runs a side effect (navigate, toggle the sidebar, click a button), waits
    // until the destination is ready, then advances. The pending guard keeps
    // double clicks / overlapping transitions from desyncing the tour.
    const go = (
      d: TutorialDriver,
      direction: "next" | "previous",
      prepare: () => void,
      waitFor: () => Promise<unknown>,
    ) => {
      if (transitionPending) return;
      transitionPending = true;
      try {
        prepare();
      } catch (error) {
        console.warn("Tutorial step setup failed", error);
      }
      void Promise.resolve()
        .then(waitFor)
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

    const restoreSidebar = () => {
      if (restoredSidebar) return;
      restoredSidebar = true;
      setSidebarOpen(sidebarOpenOnStart);
    };

    navigateTo("tree-view");
    setSidebarOpen(false);

    // Create-tree flow (new users only). Creating a tree is irreversible, so
    // the dialog step is forward-only; everything after it is fully reversible.
    const createTreeSteps: DriveStep[] = hadTreeOnStart
      ? []
      : [
          {
            element: CREATE_TREE_SELECTOR,
            popover: {
              title: t("create-tree.title"),
              description: t("create-tree.body"),
              side: "top",
              align: "center",
              onNextClick: (_, __, { driver: d }) => {
                go(
                  d,
                  "next",
                  () =>
                    document
                      .querySelector<HTMLElement>(CREATE_TREE_SELECTOR)
                      ?.click(),
                  async () => {
                    await waitForElement(CREATE_DIALOG_SELECTOR);
                    await waitForElement(TREE_NAME_INPUT_SELECTOR);
                    setReactInputValue(
                      TREE_NAME_INPUT_SELECTOR,
                      t("tree-name.default"),
                    );
                  },
                );
              },
            },
          },
          {
            element: CREATE_DIALOG_SELECTOR,
            popover: {
              title: t("tree-name.title"),
              description: t("tree-name.body"),
              side: "right",
              align: "center",
              showButtons: ["next"],
              showProgress: false,
              onNextClick: (_, __, { driver: d }) => {
                const button = document.querySelector<HTMLButtonElement>(
                  TREE_CREATE_BUTTON_SELECTOR,
                );
                if (!button) return;
                if (button.disabled) {
                  setReactInputValue(
                    TREE_NAME_INPUT_SELECTOR,
                    t("tree-name.default"),
                  );
                  return;
                }
                go(
                  d,
                  "next",
                  () => button.click(),
                  async () => {
                    await waitForSelectedTree();
                    await waitForElement(ADD_MEMBER_SELECTOR);
                  },
                );
              },
            },
          },
        ];

    const steps: DriveStep[] = [
      // Welcome
      {
        popover: {
          title: t("welcome.title"),
          description: t("welcome.body"),
        },
      },

      ...createTreeSteps,

      // Add a person. Next opens the sidebar. For new users this sits right
      // after the irreversible tree creation, so Back is hidden here.
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
          showButtons: hadTreeOnStart ? ["previous", "next"] : ["next"],
          onNextClick: (_, __, { driver: d }) => {
            go(
              d,
              "next",
              () => setSidebarOpen(true),
              () => waitForElement(SIDEBAR_SELECTOR),
            );
          },
        },
      },

      // Sidebar overview. Back closes the sidebar again.
      {
        element: SIDEBAR_SELECTOR,
        popover: {
          title: t("sidebar-panel.title"),
          description: t("sidebar-panel.body"),
          side: "right",
          align: "center",
          onPrevClick: (_, __, { driver: d }) => {
            go(
              d,
              "previous",
              () => setSidebarOpen(false),
              () => waitForElement(ADD_MEMBER_SELECTOR),
            );
          },
        },
      },

      // Tab bar. Next navigates to tree management; Back re-opens the sidebar.
      {
        element: tabsSelector,
        popover: {
          title: t("switch-views.title"),
          description: t("switch-views.body"),
          side: "bottom",
          align: "start",
          onPrevClick: (_, __, { driver: d }) => {
            go(
              d,
              "previous",
              () => setSidebarOpen(true),
              () => waitForElement(SIDEBAR_SELECTOR),
            );
          },
          onNextClick: (_, __, { driver: d }) => {
            go(
              d,
              "next",
              () => navigateTo("database-management-view"),
              () => waitForElement(NEW_TREE_SELECTOR),
            );
          },
        },
      },

      // Tree management. Next navigates to friends; Back returns to the tree.
      {
        element: NEW_TREE_SELECTOR,
        popover: {
          title: t("tree-management.title"),
          description: t("tree-management.body"),
          side: "bottom",
          align: "start",
          onPrevClick: (_, __, { driver: d }) => {
            go(
              d,
              "previous",
              () => navigateTo("tree-view"),
              () => waitForElement(tabsSelector),
            );
          },
          onNextClick: (_, __, { driver: d }) => {
            go(
              d,
              "next",
              () => navigateTo("friends-view"),
              () => waitForElement(ADD_FRIEND_SELECTOR),
            );
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
            go(
              d,
              "previous",
              () => navigateTo("database-management-view"),
              () => waitForElement(NEW_TREE_SELECTOR),
            );
          },
        },
      },

      // Done. Back returns to the friends tab.
      {
        popover: {
          title: t("finish.title"),
          description: t("finish.body"),
          onPrevClick: (_, __, { driver: d }) => {
            go(
              d,
              "previous",
              () => navigateTo("friends-view"),
              () => waitForElement(ADD_FRIEND_SELECTOR),
            );
          },
        },
      },
    ];

    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: false,
      // The tour drives every action itself; blocking interaction with the
      // spotlight and the keyboard stops stray clicks/typing from desyncing it.
      disableActiveInteraction: true,
      allowKeyboardControl: false,
      showButtons: ["next", "previous"],
      nextBtnText: t("buttons.next"),
      prevBtnText: t("buttons.prev"),
      doneBtnText: t("buttons.done"),
      onHighlighted: (element, _step, { driver: d }) => {
        scheduleReposition(d);
        clearSettleTimers();
        SETTLE_REFRESH_DELAYS_MS.forEach((delay) => {
          settleTimers.push(
            window.setTimeout(() => scheduleReposition(d), delay),
          );
        });
        activeObserver?.disconnect();
        activeObserver = undefined;
        if (element instanceof HTMLElement) {
          activeObserver = new ResizeObserver(() => scheduleReposition(d));
          activeObserver.observe(element);
        }
      },
      onDeselected: () => {
        clearSettleTimers();
        activeObserver?.disconnect();
        activeObserver = undefined;
      },
      onDestroyed: () => {
        if (finished) return;
        finished = true;
        navigateTo("tree-view");
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
      clearSettleTimers();
      activeObserver?.disconnect();
      if (pendingRaf) window.cancelAnimationFrame(pendingRaf);
      restoreSidebar();
      driverObj.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  return null;
};
