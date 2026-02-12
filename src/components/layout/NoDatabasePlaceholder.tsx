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
  const setSelectedDatabase = useFamilyTreeSettings(
    (s) => s.setSelectedDatabase,
  );
  const { importDatabase, importDatabaseCheck } = useDatabaseManager();

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
    </Empty>
  );

  async function handleImportDatabase() {
    const check = await importDatabaseCheck();
    if (!check) return;
    try {
      if (!check.collision) {
        const newDatabase = await importDatabase(check.sourcePath, false);
        setSelectedDatabase(newDatabase);
        toast.success(t("toast-success"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("toast-error"));
    }
  }
};
