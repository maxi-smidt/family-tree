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
import { CreateDatabaseDialog } from "@/components/shared/dialog/CreateDatabaseDialog";
import { PasswordDialog } from "@/components/shared/dialog/PasswordDialog";
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
    resolve: (password: string | null | undefined) => void;
  } | null>(null);
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const { importDatabase, importDatabaseCheck, inspectDatabaseWithPassword } =
    useDatabaseManager();

  const askPassword = () => {
    return new Promise<string | null | undefined>((resolve) => {
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
          passwordDialogState?.resolve(undefined);
          setPasswordDialogState(null);
        }}
      />
    </Empty>
  );

  async function handleImportDatabase() {
    let check = await importDatabaseCheck();
    if (!check) return;

    // Check if file requires password for inspection (password-encrypted and metadata not yet extracted)
    let password: string | null | undefined = null;
    if (check.meta.passwordRequired && check.meta.id === null) {
      // Need password to inspect the file
      password = await askPassword();
      if (password === undefined) {
        // User cancelled password dialog
        return;
      }

      // If password is null, user confirmed with empty password field
      if (password === null) {
        toast.error(t("toast-error"));
        return;
      }

      // Re-inspect with password to get metadata
      try {
        check = await inspectDatabaseWithPassword(check.sourcePath, password);
      } catch (err) {
        console.error(err);
        toast.error(t("toast-error"));
        return;
      }
    } else if (check.meta.passwordRequired) {
      // Password required for import but metadata already extracted
      password = await askPassword();
      if (password === undefined) {
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
      } else {
        toast.error(t("toast-collision"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("toast-error"));
    }
  }
};
