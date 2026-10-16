import { SidebarProvider } from "@/components/ui/sidebar";
import { FamilyTreeSidebar } from "@/components/sidebar/FamilyTreeSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReactNode } from "react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
import { TutorialTour } from "@/components/tutorial/TutorialTour";
import { LegalGateDialog } from "@/components/legal/LegalGateDialog";
import {
  MobileTabBar,
  useHasMobileTabBar,
} from "@/components/layout/MobileTabBar";

/** Inside the SidebarProvider so the tab bar can open the sidebar sheet. */
const MainArea = ({ children }: { children: ReactNode }) => {
  const hasTabBar = useHasMobileTabBar();
  return (
    // dvh, not vh: on phones 100vh reaches under the browser's toolbar and
    // would hide the tab bar.
    <main className="relative flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-background">
      <SessionExpiryBanner />
      <div className="relative min-h-0 flex-1">{children}</div>
      {hasTabBar && <MobileTabBar />}
    </main>
  );
};

export const Layout = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen, setSidebarOpen } = useFamilyTreeSettings();

  return (
    <TooltipProvider delayDuration={500}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={(v) => setSidebarOpen(v)}
      >
        <FamilyTreeSidebar />
        <MainArea>{children}</MainArea>
        <TutorialTour />
        <LegalGateDialog />
      </SidebarProvider>
    </TooltipProvider>
  );
};
