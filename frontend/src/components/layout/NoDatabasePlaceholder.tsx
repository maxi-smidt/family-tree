import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { pickFile, useTreeManager } from "@/hooks/useTreeManager";

export const NoDatabasePlaceholder = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.no-database-placeholder",
  });
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [passwordDialogState, setPasswordDialogState] = useState<{
    isOpen: boolean;
    resolve: (password: string | null | undefined) => void;
  } | null>(null);
  const { importDatabase, inspectImport } = useTreeManager();

  const askPassword = () =>
    new Promise<string | null | undefined>((resolve) => {
      setPasswordDialogState({ isOpen: true, resolve });
    });

  return (
    <Empty className="h-full w-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>{t("title")}</EmptyTitle>
        <EmptyDescription>{t("description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          data-tutorial="create-tree"
        >
          {t("create")}
        </Button>
        <Button variant="outline" onClick={() => void handleImportDatabase()}>
          {t("import")}
        </Button>
      </EmptyContent>
      <CreateDatabaseDialog
        isOpen={isCreateDialogOpen}
        onConfirm={() => setIsCreateDialogOpen(false)}
        onCancel={() => setIsCreateDialogOpen(false)}
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
    const file = await pickFile(".treedb");
    if (!file) return;

    try {
      const info = await inspectImport(file);
      let password: string | undefined;

      if (info.password_required) {
        const providedPassword = await askPassword();
        if (providedPassword === undefined) return;
        if (!providedPassword) {
          toast.error(t("toast-error"));
          return;
        }
        password = providedPassword;
      }

      await importDatabase(file, password);
      toast.success(t("toast-success"));
    } catch (error) {
      console.error(error);
      toast.error(t("toast-error"));
    }
  }
};
