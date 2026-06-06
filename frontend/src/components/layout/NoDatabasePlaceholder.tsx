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
import { pickFile, useTreeManager } from "@/hooks/useTreeManager";
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
  const { importDatabase, inspectImport } = useTreeManager();

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
    const file = await pickFile(".treedb");
    if (!file) return;

    try {
      const info = await inspectImport(file);
      let password: string | undefined;
      if (info.password_required) {
        const pw = await askPassword();
        if (pw === undefined) return; // cancelled
        if (!pw) {
          toast.error(t("toast-error"));
          return;
        }
        password = pw;
      }

      await importDatabase(file, password);
      toast.success(t("toast-success"));
    } catch (err) {
      console.error(err);
      toast.error(t("toast-error"));
    }
  }
};
