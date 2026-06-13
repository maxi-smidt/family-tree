import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useAuthStore, useFeature } from "@/hooks/useAuthStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { pickFile, useTreeManager } from "@/hooks/useTreeManager";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShareTreeDialog } from "@/components/view/database-management-view/dialog/ShareTreeDialog";
import { AdminDialog } from "@/components/admin/AdminDialog";
import { PasswordDialog } from "@/components/shared/dialog/PasswordDialog";
import { toast } from "sonner";
import {
  Share2,
  HardDriveUpload,
  HardDriveDownload,
  FileUp,
  FileDown,
  Activity,
  Settings,
} from "lucide-react";

interface MobileManagementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MobileManagementSheet = ({
  open,
  onOpenChange,
}: MobileManagementSheetProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.mobile-management",
  });
  const { t: tDmv } = useTranslation(undefined, {
    keyPrefix: "database-management-view",
  });

  const selectedTree = useTreeStore((s) => s.selectedTree);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const user = useAuthStore((s) => s.user);
  const gedcomEnabled = useFeature("gedcom");
  const activityEnabled = useFeature("activity_log");
  const { navigateTo } = useNavigationStore();
  const {
    exportDatabase,
    importDatabase,
    inspectImport,
    exportGedcom,
    importGedcom,
  } = useTreeManager();

  const role = selectedTree?.role;
  const isOwner = role === "owner";
  const isAdmin = !!user?.is_admin;

  const [shareOpen, setShareOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [passwordDialogState, setPasswordDialogState] = useState<{
    isOpen: boolean;
    mode: "export" | "import";
    resolve: (password: string | null | undefined) => void;
  } | null>(null);

  const askPassword = (mode: "export" | "import") => {
    return new Promise<string | null | undefined>((resolve) => {
      setPasswordDialogState({ isOpen: true, mode, resolve });
    });
  };

  const handleImportDatabase = async () => {
    const file = await pickFile(".treedb");
    if (!file) return;
    try {
      const info = await inspectImport(file);
      let password: string | undefined;
      if (info.password_required) {
        const pw = await askPassword("import");
        if (pw === undefined) return;
        if (!pw) {
          toast.error(tDmv("toast-import-error"));
          return;
        }
        password = pw;
      }
      await importDatabase(file, password);
      toast.success(tDmv("toast-import-success"));
    } catch (err) {
      console.error(err);
      toast.error(tDmv("toast-import-error"));
    }
  };

  const handleExportDatabase = async () => {
    if (!selectedTree) return;
    const password = await askPassword("export");
    if (password === undefined) return;
    try {
      await exportDatabase(selectedTree, password || undefined);
    } catch (err) {
      console.error(err);
      toast.error(tDmv("toast-export-error"));
    }
  };

  const handleImportGedcom = async () => {
    const file = await pickFile(".ged,.gedcom");
    if (!file) return;
    try {
      await importGedcom(file);
      toast.success(tDmv("toast-gedcom-import-success"));
    } catch (err) {
      console.error(err);
      toast.error(tDmv("toast-gedcom-import-error"));
    }
  };

  const handleExportGedcom = async () => {
    if (!selectedTree) return;
    try {
      await exportGedcom(selectedTree);
    } catch (err) {
      console.error(err);
      toast.error(tDmv("toast-gedcom-export-error"));
    }
  };

  const roleBadgeLabel = () => {
    if (role === "owner") return t("role-owner");
    if (role === "editor") return t("role-editor");
    if (role === "viewer") return t("role-viewer");
    return null;
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="px-0 pb-8">
          <SheetHeader className="px-4 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              {t("title")}
              {role && (
                <Badge variant="outline" className="font-normal text-xs">
                  {roleBadgeLabel()}
                </Badge>
              )}
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              {selectedTree ? selectedTree.name : t("no-tree-selected")}
            </p>
          </SheetHeader>

          <div className="max-h-[80vh] overflow-y-auto">
            {/* Sharing group — owner only */}
            {isOwner && selectedTree && (
              <div className="px-4 pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  {t("group-sharing")}
                </p>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3"
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  {t("share-action")}
                </Button>
              </div>
            )}

            {/* Data group */}
            <div className="px-4 pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {t("group-data")}
              </p>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3"
                disabled={!selectedTree}
                onClick={() => void handleExportDatabase()}
              >
                <HardDriveUpload className="h-4 w-4 shrink-0" />
                {t("export-action")}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3"
                onClick={() => void handleImportDatabase()}
              >
                <HardDriveDownload className="h-4 w-4 shrink-0" />
                {t("import-action")}
              </Button>
              {gedcomEnabled && (
                <>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3"
                    disabled={!selectedTree}
                    onClick={() => void handleExportGedcom()}
                  >
                    <FileUp className="h-4 w-4 shrink-0" />
                    {t("export-gedcom-action")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3"
                    onClick={() => void handleImportGedcom()}
                  >
                    <FileDown className="h-4 w-4 shrink-0" />
                    {t("import-gedcom-action")}
                  </Button>
                </>
              )}
            </div>

            {/* Activity group */}
            {activityEnabled && (
              <div className="px-4 pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  {t("activity-action")}
                </p>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3"
                  onClick={() => {
                    navigateTo("activity-view");
                    onOpenChange(false);
                  }}
                >
                  <Activity className="h-4 w-4 shrink-0" />
                  {t("activity-action")}
                </Button>
              </div>
            )}

            {/* Admin group — admin only */}
            {isAdmin && (
              <div className="px-4 pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  {t("group-admin")}
                </p>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3"
                  onClick={() => setAdminOpen(true)}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  {t("admin-action")}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {selectedTree && isOwner && (
        <ShareTreeDialog
          tree={selectedTree}
          isOpen={shareOpen}
          onClose={() => {
            setShareOpen(false);
            void loadTrees();
          }}
        />
      )}

      {isAdmin && (
        <AdminDialog isOpen={adminOpen} onClose={() => setAdminOpen(false)} />
      )}

      <PasswordDialog
        isOpen={!!passwordDialogState?.isOpen}
        mode={passwordDialogState?.mode ?? "export"}
        onConfirm={(password) => {
          passwordDialogState?.resolve(password);
          setPasswordDialogState(null);
        }}
        onCancel={() => {
          passwordDialogState?.resolve(undefined);
          setPasswordDialogState(null);
        }}
      />
    </>
  );
};
