import { useState, useMemo, useEffect } from "react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { Member, MemberObject } from "@/types/member";
import { DatabaseService } from "@/services/DatabaseService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "@/constants";
import DatabaseSql from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import { useMergeManager } from "@/hooks/useMergeManager";
import { MergePreview } from "./MergePreview";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "lucide-react";

const EMPTY_DB_ID = "empty_db";

export const DatabaseMergeView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "merge-view.view",
  });
  const { databases } = useFamilyTreeSettings();
  const { isMerging, performMerge } = useMergeManager();

  const [db1Id, setDb1Id] = useState<string>("");
  const [db2Id, setDb2Id] = useState<string>("");
  const [newDbName, setNewDbName] = useState<string>("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [previewData, setPreviewData] = useState<{
    conflicts: Member[];
    mergedCount: number;
    totalMembers: number;
  } | null>(null);

  const availableDatabases = useMemo(() => {
    return databases;
  }, [databases]);

  const handleDb1Change = (val: string) => {
    setDb1Id(val);
    updateDefaultName(val, db2Id);
  };

  const handleDb2Change = (val: string) => {
    setDb2Id(val);
    updateDefaultName(db1Id, val);
  };

  const updateDefaultName = (id1: string, id2: string) => {
    const name1 = availableDatabases.find((d) => d.id === id1)?.name || "";
    const name2 = availableDatabases.find((d) => d.id === id2)?.name || "";

    if (id1 === EMPTY_DB_ID && id2 === EMPTY_DB_ID) {
      setNewDbName(t("new-database"));
    } else if (id1 === EMPTY_DB_ID) {
      setNewDbName(`${name2} ${t("database-copy")}`);
    } else if (id2 === EMPTY_DB_ID) {
      setNewDbName(`${name1} ${t("database-copy")}`);
    } else if (name1 && name2) {
      setNewDbName(`${name1} + ${name2}`);
    } else {
      setNewDbName(name1 || name2 || "");
    }
  };

  const loadDatabaseMembers = async (dbId: string): Promise<Member[]> => {
    if (dbId === EMPTY_DB_ID) return [];

    const appConfigPath = await appConfigDir();
    const fullPath = await join(
      appConfigPath,
      DATABASE_DIRECTORY,
      `${dbId}.${EXTENSION}`,
    );
    const connectionString = `sqlite:${fullPath}`;

    const db = await DatabaseSql.load(connectionString);
    const membersDB = await DatabaseService.getMembers(db);
    await db.close();

    return membersDB.map((m) => {
      const validGender = m.gender === "m" || m.gender === "f" ? m.gender : "o";
      return {
        id: m.id,
        gender: validGender as "m" | "f" | "o",
        firstName: m.firstName,
        lastName: m.lastName,
        maidenName: m.maidenName,
        imageData: m.imageData,
        date: {
          birth: m.dateOfBirth,
          death: m.dateOfDeath,
        },
        parents: {
          paternalParent: null,
          maternalParent: null,
        },
        additionalData: m.additionalData,
        isCollapsed: !!m.isCollapsed,
        position: {
          x: m.positionX,
          y: m.positionY,
        },
        relations: [],
      };
    });
  };

  const handlePreview = async () => {
    if (!db1Id || !db2Id) return;

    try {
      const members1 = await loadDatabaseMembers(db1Id);
      const members2 = await loadDatabaseMembers(db2Id);

      const duplicates: Member[] = [];

      members1.forEach((m1) => {
        const match = members2.find((m2) => MemberObject.equal(m1, m2));
        if (match) {
          duplicates.push(m1);
        }
      });

      setPreviewData({
        conflicts: duplicates,
        mergedCount: members1.length + members2.length - duplicates.length,
        totalMembers: members1.length + members2.length,
      });
    } catch (e) {
      console.error("Error loading databases for preview", e);
      toast.error(t("toast-preview-error"));
    }
  };

  useEffect(() => {
    if (db1Id && db2Id) {
      handlePreview();
    } else {
      setPreviewData(null);
    }
  }, [db1Id, db2Id]);

  const handleMerge = async () => {
    const success = await performMerge(db1Id, db2Id, newDbName);
    if (success) {
      setDb1Id("");
      setDb2Id("");
      setNewDbName("");
      setPreviewData(null);
    }
    setShowConfirmDialog(false);
  };

  const handleMergeClick = () => {
    setShowConfirmDialog(true);
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("source-database-1")}</Label>
          <Select value={db1Id} onValueChange={handleDb1Change}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("select-placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_DB_ID}>
                {t("empty-database-select")}
              </SelectItem>
              {availableDatabases.length > 0 && <SelectSeparator />}
              {availableDatabases.map((db) => (
                <SelectItem
                  key={db.id}
                  value={db.id}
                  disabled={db.id === db2Id}
                >
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("source-database-2")}</Label>
          <Select value={db2Id} onValueChange={handleDb2Change}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("select-placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_DB_ID}>
                {t("empty-database-select")}
              </SelectItem>
              {availableDatabases.length > 0 && <SelectSeparator />}
              {availableDatabases.map((db) => (
                <SelectItem
                  key={db.id}
                  value={db.id}
                  disabled={db.id === db1Id}
                >
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {db1Id && db2Id && (
        <div className="space-y-4 py-4 border-y">
          <div className="grid gap-2">
            <Label htmlFor="new-db-name">{t("new-database-field")}</Label>
            <div className="flex gap-2">
              <Input
                id="new-db-name"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder={t("new-database-placeholder")}
                className="w-full"
              />
              <Button
                onClick={handleMergeClick}
                disabled={isMerging || !newDbName}
              >
                {isMerging ? t("merging-database") : t("merge-database")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <MergePreview previewData={previewData} />

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Confirm Database Merge
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2">
              <p>
                You are about to merge two databases into a new database named:{" "}
                <strong>{newDbName}</strong>
              </p>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 space-y-2">
                <p className="font-semibold text-amber-900 dark:text-amber-100 text-sm">
                  Please note:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-200">
                  <li>The original databases will remain unchanged</li>
                  <li>
                    Duplicate members (same name, birth date, gender) will be
                    merged
                  </li>
                  <li>
                    Notes from duplicate members will be combined in the merged
                    database
                  </li>
                  <li>
                    All relationships and gallery images will be preserved
                  </li>
                  <li>This action cannot be undone</li>
                </ul>
              </div>
              {previewData && previewData.conflicts.length > 0 && (
                <p className="text-sm">
                  <strong>{previewData.conflicts.length}</strong> duplicate
                  member{previewData.conflicts.length !== 1 ? "s" : ""} will be
                  merged.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMerging}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={isMerging}>
              {isMerging ? "Merging..." : "Confirm Merge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
