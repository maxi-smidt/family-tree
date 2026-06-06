import { useState, useMemo, useEffect } from "react";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { mapMemberFromDB, Member, MemberObject } from "@/types/member";
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
import { toast } from "sonner";
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
import { ViewLayout } from "@/components/layout/ViewLayout";

const EMPTY_DB_ID = "empty_db";

export const DatabaseMergeView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "merge-view.view" });
  const databases = useDatabaseStore((s) => s.databases);
  const mergeDatabases = useDatabaseStore((s) => s.mergeDatabases);
  const createDatabase = useDatabaseStore((s) => s.createDatabase);

  const [db1Id, setDb1Id] = useState<string>("");
  const [db2Id, setDb2Id] = useState<string>("");
  const [newDbName, setNewDbName] = useState<string>("");
  const [isMerging, setIsMerging] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [previewData, setPreviewData] = useState<{
    conflicts: Member[];
    mergedCount: number;
    totalMembers: number;
  } | null>(null);

  const availableDatabases = useMemo(() => databases, [databases]);

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
    const rows = await DatabaseService.getMembers(dbId);
    return rows.map((m) => mapMemberFromDB(m));
  };

  const handlePreview = async () => {
    if (!db1Id || !db2Id) return;

    try {
      const members1 = await loadDatabaseMembers(db1Id);
      const members2 = await loadDatabaseMembers(db2Id);

      const duplicates: Member[] = [];
      members1.forEach((m1) => {
        if (members2.find((m2) => MemberObject.equal(m1, m2))) {
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
      void handlePreview();
    } else {
      setPreviewData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db1Id, db2Id]);

  const handleMerge = async () => {
    setShowConfirmDialog(false);
    if (!newDbName) {
      toast.error(t("toast-error-name"));
      return;
    }

    const sources = [db1Id, db2Id].filter(
      (id) => id && id !== EMPTY_DB_ID,
    ) as string[];

    setIsMerging(true);
    try {
      if (sources.length === 0) {
        await createDatabase(newDbName);
      } else {
        await mergeDatabases(newDbName, sources[0], sources[1]);
      }
      setDb1Id("");
      setDb2Id("");
      setNewDbName("");
      setPreviewData(null);
      toast.success(t("toast-merge-success"));
    } catch (e) {
      console.error("Merge failed", e);
      toast.error(t("toast-error-merge"));
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <ViewLayout title={t("title")}>
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
                onClick={() => setShowConfirmDialog(true)}
                disabled={isMerging || !newDbName}
              >
                {isMerging ? t("merging-database") : t("merge-database")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <MergePreview previewData={previewData} />

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              {t("confirm-title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm-description", { name: newDbName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMerging}>
              {t("confirm-cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={isMerging}>
              {isMerging ? t("merging-database") : t("confirm-merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewLayout>
  );
};
