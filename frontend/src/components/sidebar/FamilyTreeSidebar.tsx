import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { DatabaseSelector } from "@/components/sidebar/DatabaseSelector.tsx";
import { AppNav } from "@/components/sidebar/AppNav";
import { PreferencesMenu } from "@/components/sidebar/PreferencesMenu";
import { UserMenu } from "@/components/auth/UserMenu";
import { StorageUsagePanel } from "@/components/shared/StorageUsagePanel";
import { LegalDocsDialog } from "@/components/legal/LegalDocsDialog";
import { APP_VERSION } from "@/lib/buildInfo";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";

const RELEASES_URL = "https://github.com/maxi-smidt/family-tree/releases";
// Only a tagged vX.Y.Z build has a matching GitHub release; dev/branch
// builds (e.g. "dev", "main-abc1234") link to the releases index instead.
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * The app's left sidebar: workspace switcher on top, the grouped view
 * navigation, then storage, the account menu and display preferences.
 */
export function FamilyTreeSidebar() {
  const { t } = useTranslation(undefined, { keyPrefix: "sidebar" });
  const { t: tLegal } = useTranslation(undefined, { keyPrefix: "legal" });
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const showStorage = !!selectedTree?.id;
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);
  const releaseUrl = RELEASE_VERSION_RE.test(APP_VERSION)
    ? `${RELEASES_URL}/tag/v${APP_VERSION}`
    : RELEASES_URL;

  return (
    <Sidebar>
      <SidebarHeader className="p-3 pb-1" data-tutorial="sidebar">
        <DatabaseSelector />
      </SidebarHeader>
      <SidebarContent className="gap-0 px-1">
        <AppNav />
      </SidebarContent>
      <SidebarFooter className="gap-1 p-3 pt-1">
        {showStorage && <StorageUsagePanel workspaceId={selectedTree.id} />}
        <div className="flex items-center gap-1 border-t border-sidebar-border pt-2">
          <UserMenu />
          <PreferencesMenu />
        </div>
        <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground select-none">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setLegalDocsOpen(true)}
          >
            {tLegal("legal-link")}
          </button>
          <span aria-hidden="true">·</span>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
            aria-label={t("version-link-label")}
          >
            v{APP_VERSION}
          </a>
        </div>
      </SidebarFooter>
      <LegalDocsDialog open={legalDocsOpen} onOpenChange={setLegalDocsOpen} />
    </Sidebar>
  );
}
