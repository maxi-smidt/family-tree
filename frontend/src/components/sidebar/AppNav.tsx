import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { MobileManagementSheet } from "@/components/layout/MobileManagementSheet";
import { useNavEntries } from "@/hooks/useNavEntries";

/**
 * The app's primary navigation: every view, grouped into Explore / Insights /
 * Workspace, in the left sidebar. Replaces the old top tab strip, whose
 * twelve tabs no longer fit and were truncated to "Tr…", "L…".
 */
export const AppNav = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "layout" });
  const { isMobile, setOpenMobile } = useSidebar();
  const { groups, open, isActive } = useNavEntries(() => {
    if (isMobile) setOpenMobile(false);
  });
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <nav aria-label={t("nav.aria-label")} data-tutorial="views-tabs">
      {groups.map(({ id, entries }) => {
        return (
          <SidebarGroup key={id} className="py-1">
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider">
              {t(`nav.${id}`)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {entries.map((entry) => {
                  const Icon = entry.icon;
                  const active = isActive(entry);
                  return (
                    <SidebarMenuItem key={entry.key}>
                      <SidebarMenuButton
                        isActive={active}
                        aria-current={active ? "page" : undefined}
                        onClick={() => open(entry)}
                        className="h-9 gap-2.5 font-medium text-sidebar-foreground/80 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-xs [&[data-active=true]>svg]:text-primary"
                      >
                        <Icon />
                        <span>{entry.label}</span>
                      </SidebarMenuButton>
                      {!!entry.badge && entry.badge > 0 && (
                        <SidebarMenuBadge
                          className={
                            entry.badgeTone === "accent"
                              ? "bg-primary-soft text-primary"
                              : "bg-warning-soft text-warning"
                          }
                        >
                          {entry.badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
      {isMobile && (
        <SidebarGroup className="py-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-9 gap-2.5 font-medium"
                onClick={() => setManageOpen(true)}
              >
                <SlidersHorizontal />
                <span>{t("nav.manage")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <MobileManagementSheet
            open={manageOpen}
            onOpenChange={setManageOpen}
          />
        </SidebarGroup>
      )}
    </nav>
  );
};
