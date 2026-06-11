import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { FamilyTreeSidebar } from "@/components/sidebar/FamilyTreeSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReactNode } from "react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";

export const Layout = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen, setSidebarOpen } = useFamilyTreeSettings();

  return (
    <TooltipProvider delayDuration={500}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={(v) => setSidebarOpen(v)}
      >
        <FamilyTreeSidebar />
        <main className="w-full h-screen overflow-hidden relative">
          <SessionExpiryBanner />
          <div className="absolute top-4 left-4 z-50">
            <SidebarTrigger />
          </div>
          {children}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
};
