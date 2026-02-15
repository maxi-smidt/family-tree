import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CreateDatabaseDialog } from "@/components/dialog/CreateDatabaseDialog";
import { PasswordDialog } from "@/components/dialog/PasswordDialog";
import { useState } from "react";
import { toast } from "sonner";
import { useDatabaseManager } from "@/hooks/useDatabaseManager";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTranslation } from "react-i18next";

export const NoDatabasePlaceholder = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.no-database-placeholder",
  });
  const [isCreateDatabaseDialogOpen, setIsCreateDatabaseDialogOpen] =
    useState(false);
  const [passwordDialogState, setPasswordDialogState] = useState<{
    isOpen: boolean;
    resolve: (password: string | null) => void;
  } | null>(null);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const { importDatabase, importDatabaseCheck } = useDatabaseManager();

  const askPassword = () => {
    return new Promise<string | null>((resolve) => {
      setPasswordDialogState({ isOpen: true, resolve });
    });
  };

  return (
    <Empty className="w-full h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>{t("title")}</EmptyTitle>
        <EmptyDescription>{t("description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={() => setIsCreateDatabaseDialogOpen(true)}>
          {t("create")}
        </Button>
        <Button variant="outline" onClick={handleImportDatabase}>
          {t("import")}
        </Button>
      </EmptyContent>
      <CreateDatabaseDialog
        isOpen={isCreateDatabaseDialogOpen}
        onConfirm={() => setIsCreateDatabaseDialogOpen(false)}
        onCancel={() => setIsCreateDatabaseDialogOpen(false)}
      />
      <PasswordDialog
        isOpen={!!passwordDialogState?.isOpen}
        mode="import"
        onConfirm={(password) => {
          passwordDialogState?.resolve(password);
          setPasswordDialogState(null);
        }}
        onCancel={() => {
          passwordDialogState?.resolve(null);
          setPasswordDialogState(null);
        }}
      />
    </Empty>
  );

  async function handleImportDatabase() {
    const check = await importDatabaseCheck();
    if (!check) return;

    // Check if file is encrypted and ask for password
    let password: string | null = null;
    if (check.meta.encrypted) {
      password = await askPassword();
      if (password === null) {
        // User cancelled password dialog
        return;
      }
    }

    try {
      if (!check.collision) {
        const newDatabase = await importDatabase(
          check.sourcePath,
          false,
          password || undefined,
        );
        setSelectedDatabase(newDatabase);
        toast.success(t("toast-success"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("toast-error"));
    }
  }
};
