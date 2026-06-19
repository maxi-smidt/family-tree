import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { EdgeTypeSelector } from "@/components/sidebar/EdgeTypeSelector.tsx";
import { DatabaseSelector } from "@/components/sidebar/DatabaseSelector.tsx";
import { LanguageSelector } from "@/components/sidebar/LanguageSelector.tsx";
import { ThemeSelector } from "@/components/sidebar/ThemeSelector.tsx";
import { UserMenu } from "@/components/auth/UserMenu";
import { StorageUsagePanel } from "@/components/shared/StorageUsagePanel";
import { APP_VERSION } from "@/lib/buildInfo";
import { useTranslation } from "react-i18next";
import { useTreeStore, isVirtualId } from "@/hooks/useTreeStore";

export function FamilyTreeSidebar() {
  const { t } = useTranslation(undefined, { keyPrefix: "sidebar" });
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const showStorage = !!selectedTree?.id && !isVirtualId(selectedTree.id);

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("appearance")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <ThemeSelector />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <EdgeTypeSelector />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <LanguageSelector />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup data-tutorial="sidebar">
          <SidebarGroupLabel>{t("dataManagement")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <DatabaseSelector />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {showStorage && <StorageUsagePanel treeId={selectedTree.id} />}
        <UserMenu />
        <div className="text-xs text-muted-foreground p-2 text-center select-none">
          v{APP_VERSION}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
