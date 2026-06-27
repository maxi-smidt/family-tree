import { useEffect, useRef, useState } from "react";
import { useJobStore } from "@/hooks/useJobStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { TreeService } from "@/services/TreeService";
import { DuplicatePair, MergePreviewResult } from "@/types/merge";
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
import { MergeConflictResolver } from "./MergeConflictResolver";
import {
  PairResolutionState,
  buildInitialResolutionState,
  buildPairKey,
  buildResolutionsPayload,
} from "@/utils/mergeUtils";

type Step = "select" | "review";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const MergeTreesDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "merge-view.view" });
  const { t: tr } = useTranslation(undefined, {
    keyPrefix: "merge-view.resolve",
  });
  const trees = useTreeStore((s) => s.trees);
  const mergeTrees = useTreeStore((s) => s.mergeTrees);
  const mergePct = useJobStore((s) => s.activeJobPct);

  const [step, setStep] = useState<Step>("select");
  const [db1Id, setDb1Id] = useState<string>("");
  const [db2Id, setDb2Id] = useState<string>("");
  const [newDbName, setNewDbName] = useState<string>("");
  const [isMerging, setIsMerging] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<MergePreviewResult | null>(
    null,
  );

  // Per-pair resolution state (keyed by buildPairKey)
  const [resolutionStates, setResolutionStates] = useState<
    Map<string, PairResolutionState>
  >(new Map());

  // Abort controller for in-flight preview fetch
  const abortRef = useRef<AbortController | null>(null);

  const resetState = () => {
    setStep("select");
    setDb1Id("");
    setDb2Id("");
    setNewDbName("");
    setPreviewData(null);
    setResolutionStates(new Map());
    abortRef.current?.abort();
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

  // Fetch backend preview whenever both sources are selected
  useEffect(() => {
    if (!db1Id || !db2Id) {
      setPreviewData(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setIsLoadingPreview(true);
    void (async () => {
      try {
        const result = await TreeService.previewMerge(db1Id, db2Id);
        if (ac.signal.aborted) return;
        setPreviewData(result);

        // Initialise resolution states for each duplicate pair
        const initStates = new Map<string, PairResolutionState>();
        for (const pair of result.duplicates) {
          const key = buildPairKey(pair.member_a.id, pair.member_b.id);
          initStates.set(key, buildInitialResolutionState(pair));
        }
        setResolutionStates(initStates);
      } catch (e) {
        if (ac.signal.aborted) return;
        console.error("Error loading merge preview", e);
        toast.error(t("toast-preview-error"));
      } finally {
        if (!ac.signal.aborted) setIsLoadingPreview(false);
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db1Id, db2Id]);

  const handlePairStateChange = (
    pair: DuplicatePair,
    updated: PairResolutionState,
  ) => {
    const key = buildPairKey(pair.member_a.id, pair.member_b.id);
    setResolutionStates((prev) => new Map(prev).set(key, updated));
  };

  const handleContinueToReview = () => {
    if (!previewData || !newDbName.trim()) return;
    setStep("review");
  };

  const handleBack = () => {
    setStep("select");
  };

  const handleMerge = async () => {
    if (!db1Id || !db2Id) return;
    if (!newDbName.trim()) {
      toast.error(t("toast-error-name"));
      return;
    }

    const resolutions =
      previewData && previewData.duplicates.length > 0
        ? buildResolutionsPayload(previewData.duplicates, resolutionStates)
        : undefined;

    setIsMerging(true);
    try {
      await mergeTrees(newDbName.trim(), db1Id, db2Id, resolutions);
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

  const hasDuplicates =
    previewData !== null && previewData.duplicates.length > 0;
  const canContinue = !isLoadingPreview && !!previewData && !!newDbName.trim();

  // ---- Render: step 1 – source selection + summary preview ----
  if (step === "select") {
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

            {isLoadingPreview && (
              <p className="text-sm text-muted-foreground">
                {t("loading-preview")}
              </p>
            )}

            {previewData && !isLoadingPreview && (
              <div className="flex h-[360px]">
                <MergePreview
                  previewData={{
                    conflicts: previewData.duplicates.map((d) => ({
                      id: d.member_a.id,
                      gender: (d.member_a.gender as "m" | "f" | "o") ?? "o",
                      academicTitle: d.member_a.academicTitle ?? null,
                      firstName: d.member_a.firstName ?? "",
                      middleNames: d.member_a.middleNames ?? null,
                      baptismalName: d.member_a.baptismalName ?? null,
                      lastName: d.member_a.lastName ?? "",
                      maidenName: d.member_a.maidenName ?? null,
                      imageData: d.member_a.imageData ?? null,
                      deceased: d.member_a.deceased ?? false,
                      adopted: d.member_a.adopted ?? false,
                      date: {
                        birth: d.member_a.dateOfBirth ?? "",
                        death: d.member_a.dateOfDeath ?? null,
                      },
                      parents: {
                        paternalParent: null,
                        maternalParent: null,
                      },
                      additionalData: d.member_a.additionalData ?? null,
                      birthplace: d.member_a.birthplace ?? null,
                      hometown: d.member_a.hometown ?? null,
                      placesLived: [],
                      isCollapsed: false,
                      position: { x: 0, y: 0 },
                    })),
                    mergedCount: previewData.merged_count,
                    totalMembers: previewData.total_members,
                  }}
                />
              </div>
            )}
          </div>

          {isMerging && (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-300 ease-in-out"
                style={{ width: `${mergePct}%` }}
              />
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={handleClose}>
                {t("cancel")}
              </Button>
            </DialogClose>
            {hasDuplicates ? (
              <Button onClick={handleContinueToReview} disabled={!canContinue}>
                {t("review-conflicts")}
              </Button>
            ) : (
              <Button
                onClick={handleMerge}
                disabled={isMerging || !canContinue}
              >
                {isMerging ? t("merging-database") : t("merge-database")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- Render: step 2 – review & resolve conflicts ----
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>
            {tr("description", {
              count: previewData?.duplicates.length ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {previewData?.duplicates.map((pair) => {
            const key = buildPairKey(pair.member_a.id, pair.member_b.id);
            const pairState =
              resolutionStates.get(key) ?? buildInitialResolutionState(pair);
            return (
              <MergeConflictResolver
                key={key}
                pair={pair}
                sourceAName={treeName(db1Id)}
                sourceBName={treeName(db2Id)}
                state={pairState}
                onChange={(updated) => handlePairStateChange(pair, updated)}
              />
            );
          })}
        </div>

        {isMerging && (
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300 ease-in-out"
              style={{ width: `${mergePct}%` }}
            />
          </div>
        )}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleBack} disabled={isMerging}>
            {tr("back")}
          </Button>
          <Button onClick={handleMerge} disabled={isMerging}>
            {isMerging ? t("merging-database") : tr("confirm-merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
