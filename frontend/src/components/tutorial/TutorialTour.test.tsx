import { useEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarHeader,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { CreateDatabaseDialog } from "@/components/shared/dialog/CreateDatabaseDialog";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { UserPreferencesService } from "@/services/UserPreferencesService";
import { TutorialTour } from "./TutorialTour";

vi.mock("driver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("driver.js")>();
  return {
    ...actual,
    driver: (config: Parameters<typeof actual.driver>[0]) =>
      actual.driver({ ...config, animate: false }),
  };
});

const workspace = { id: "tutorial-tree", name: "Tutorial tree" };

// Keep the real driver, sidebar sheet, and creation dialog: their separate
// lifecycles are what made advancing the phone tour get stuck.
function TutorialContent({ initiallyOpenMobile = false }) {
  const { setOpenMobile } = useSidebar();
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const view = useNavigationStore((s) => s.pendingView);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setOpenMobile(initiallyOpenMobile);
  }, [initiallyOpenMobile, setOpenMobile]);

  return (
    <>
      <Sidebar>
        <SidebarHeader data-tutorial="sidebar">
          Workspace switcher
        </SidebarHeader>
        <nav data-tutorial="views-tabs">Desktop views</nav>
      </Sidebar>
      {view === "database-management-view" ? (
        <button data-tutorial="new-tree">New workspace</button>
      ) : view === "friends-view" ? (
        <div data-tutorial="add-friend">Add friend</div>
      ) : selectedTree ? (
        <button data-tutorial="add-member">Add person</button>
      ) : (
        <button data-tutorial="create-tree" onClick={() => setCreating(true)}>
          Create workspace
        </button>
      )}
      <nav data-tutorial="views-tabs-mobile">Phone views</nav>
      <CreateDatabaseDialog
        isOpen={creating}
        onConfirm={() => setCreating(false)}
        onCancel={() => setCreating(false)}
        disableCancel
      />
      <TutorialTour />
    </>
  );
}

function TutorialHarness({ initiallyOpenMobile = false }) {
  const open = useFamilyTreeSettings((s) => s.sidebarOpen);
  const setOpen = useFamilyTreeSettings((s) => s.setSidebarOpen);
  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <TutorialContent initiallyOpenMobile={initiallyOpenMobile} />
    </SidebarProvider>
  );
}

async function expectStep(title: string) {
  await waitFor(() => {
    const popover = document.querySelector<HTMLElement>(".driver-popover");
    expect(popover).not.toBeNull();
    expect(within(popover!).getByText(title, { exact: true })).toBeVisible();
  });
  // The driver commits its active step on the next frame, even without animation.
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

function clickTourButton(name: "Next" | "Back" | "Done") {
  const popover = document.querySelector<HTMLElement>(".driver-popover")!;
  fireEvent.click(within(popover).getByRole("button", { name }));
}

describe("TutorialTour navigation", () => {
  beforeEach(() => {
    useTutorialStore.setState({ isRunning: false, completed: false });
    useWorkspaceStore.setState({ selectedTree: workspace });
    useFamilyTreeSettings.setState({ sidebarOpen: true });
    useNavigationStore.setState({ pendingView: null });
    vi.spyOn(UserPreferencesService, "setTutorialCompleted").mockResolvedValue({
      completed: true,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 767px)" && window.innerWidth < 768,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { width: 390, newUser: false, initiallyOpenMobile: true },
    { width: 390, newUser: true, initiallyOpenMobile: false },
    { width: 1280, newUser: false, initiallyOpenMobile: false },
  ])(
    "completes forward and backward navigation at $width px (new user: $newUser)",
    async ({ width, newUser, initiallyOpenMobile }) => {
      vi.stubGlobal("innerWidth", width);
      if (newUser) useWorkspaceStore.setState({ selectedTree: undefined });
      const createTree = vi
        .spyOn(useWorkspaceStore.getState(), "createTree")
        .mockImplementation(async () => {
          useWorkspaceStore.setState({ selectedTree: workspace });
          return workspace;
        });
      render(<TutorialHarness initiallyOpenMobile={initiallyOpenMobile} />);
      act(() => useTutorialStore.getState().start());

      await expectStep("Welcome to Family Tree");
      clickTourButton("Next");
      if (newUser) {
        await expectStep("Create your first workspace");
        clickTourButton("Next");
        await expectStep("Name your workspace");
        clickTourButton("Next");
        await waitFor(() =>
          expect(createTree).toHaveBeenCalledWith("My first workspace"),
        );
      }
      const addTitle = newUser
        ? "Add your first person"
        : "Continue with this workspace";
      await expectStep(addTitle);
      clickTourButton("Next");
      await expectStep("Your sidebar");
      expect(
        document.querySelector('[data-tutorial="sidebar"]'),
      ).not.toBeNull();

      clickTourButton("Back");
      await expectStep(addTitle);
      clickTourButton("Next");
      await expectStep("Your sidebar");
      clickTourButton("Next");
      await expectStep("Navigate between views");
      if (width < 768) {
        await waitFor(() =>
          expect(document.querySelector('[data-mobile="true"]')).toBeNull(),
        );
      }

      clickTourButton("Back");
      await expectStep("Your sidebar");
      clickTourButton("Next");
      await expectStep("Navigate between views");
      clickTourButton("Next");
      await expectStep("Workspaces");
      clickTourButton("Back");
      await expectStep("Navigate between views");
      clickTourButton("Next");
      await expectStep("Workspaces");
      clickTourButton("Next");
      await expectStep("Friends & sharing");
      clickTourButton("Back");
      await expectStep("Workspaces");
      clickTourButton("Next");
      await expectStep("Friends & sharing");
      clickTourButton("Next");
      await expectStep("You're all set!");
      clickTourButton("Back");
      await expectStep("Friends & sharing");
      clickTourButton("Next");
      await expectStep("You're all set!");
      clickTourButton("Done");

      await waitFor(() =>
        expect(useTutorialStore.getState().completed).toBe(true),
      );
      expect(document.querySelector(".driver-popover")).toBeNull();
      expect(useNavigationStore.getState().pendingView).toBe("tree-view");
      expect(useFamilyTreeSettings.getState().sidebarOpen).toBe(true);
      if (width < 768) {
        expect(!!document.querySelector('[data-mobile="true"]')).toBe(
          initiallyOpenMobile,
        );
      }
    },
    15_000,
  );
});
