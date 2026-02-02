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

export const NoDatabasePlaceholder = () => {
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
        <EmptyTitle>No Databases Yet</EmptyTitle>
        <EmptyDescription>
          You haven&apos;t created any databases yet. Get started by creating
          your first database.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={() => setIsCreateDatabaseDialogOpen(true)}>
          Create Database
        </Button>
        <Button variant="outline" onClick={handleImportDatabase}>
          Import Database
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
        toast.success("Database imported successfully!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to import database.");
    }
  }
};
