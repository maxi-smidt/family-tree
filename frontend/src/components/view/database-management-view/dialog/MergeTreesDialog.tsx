import { useEffect, useState } from "react";
import { useTreeStore } from "@/hooks/useTreeStore";
import { mapMemberFromDB, Member, MemberObject } from "@/types/member";
import { TreeService } from "@/services/TreeService";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MergePreview } from "./MergePreview";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const MergeTreesDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "merge-view.view" });
  const trees = useTreeStore((s) => s.trees);
  const mergeTrees = useTreeStore((s) => s.mergeTrees);

  const [db1Id, setDb1Id] = useState<string>("");
  const [db2Id, setDb2Id] = useState<string>("");
  const [newDbName, setNewDbName] = useState<string>("");
  const [isMerging, setIsMerging] = useState(false);
  const [previewData, setPreviewData] = useState<{
    conflicts: Member[];
    mergedCount: number;
    totalMembers: number;
  } | null>(null);

  const resetState = () => {
    setDb1Id("");
    setDb2Id("");
    setNewDbName("");
    setPreviewData(null);
  };

  const handleClose = () => {
    if (isMerging) return;
    resetState();
    onClose();
  };

  const treeName = (id: string) => trees.find((d) => d.id === id)?.name ?? "";

  const handleDb1Change = (val: string) => {
    setDb1Id(val);
    setNewDbName(combinedName(val, db2Id));
  };

  const handleDb2Change = (val: string) => {
    setDb2Id(val);
    setNewDbName(combinedName(db1Id, val));
  };

  const combinedName = (id1: string, id2: string) => {
    const name1 = treeName(id1);
    const name2 = treeName(id2);
    if (name1 && name2) return `${name1} + ${name2}`;
    return name1 || name2 || "";
  };

  const loadMembers = async (dbId: string): Promise<Member[]> => {
    const rows = await TreeService.getMembers(dbId);
    return rows.map((m) => mapMemberFromDB(m));
  };

  useEffect(() => {
    if (!db1Id || !db2Id) {
      setPreviewData(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [members1, members2] = await Promise.all([
          loadMembers(db1Id),
          loadMembers(db2Id),
        ]);
        const duplicates = members1.filter((m1) =>
          members2.some((m2) => MemberObject.equal(m1, m2)),
        );
        if (cancelled) return;
        setPreviewData({
          conflicts: duplicates,
          mergedCount: members1.length + members2.length - duplicates.length,
          totalMembers: members1.length + members2.length,
        });
      } catch (e) {
        if (cancelled) return;
        console.error("Error loading trees for preview", e);
        toast.error(t("toast-preview-error"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db1Id, db2Id]);

  const handleMerge = async () => {
    if (!db1Id || !db2Id) return;
    if (!newDbName.trim()) {
      toast.error(t("toast-error-name"));
      return;
    }

    setIsMerging(true);
    try {
      await mergeTrees(newDbName.trim(), db1Id, db2Id);
      toast.success(t("toast-merge-success"));
      resetState();
      onClose();
    } catch (e) {
      console.error("Merge failed", e);
      toast.error(t("toast-error-merge"));
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("source-database-1")}</Label>
              <Select value={db1Id} onValueChange={handleDb1Change}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("select-placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {trees.map((db) => (
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
                  {trees.map((db) => (
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
            <div className="space-y-2">
              <Label htmlFor="new-db-name">{t("new-database-field")}</Label>
              <Input
                id="new-db-name"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder={t("new-database-placeholder")}
              />
            </div>
          )}

          {previewData && (
            <div className="flex h-[360px]">
              <MergePreview previewData={previewData} />
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isMerging}
            >
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            onClick={handleMerge}
            disabled={isMerging || !db1Id || !db2Id || !newDbName.trim()}
          >
            {isMerging ? t("merging-database") : t("merge-database")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
