import { useEffect, useRef, useState } from "react";
import { useJobStore } from "@/hooks/useJobStore";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Member } from "@/types/member";
import { SubtreeExtractDirection, SubtreeExtractPreview, Tree } from "@/types/tree";
import { formatFileSize } from "@/utils/attachmentUtils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  tree: Tree | null;
  onClose: () => void;
};

export const ExtractSubtreeDialog = ({ tree, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.extract-subtree",
  });
  const extractSubtree = useTreeStore((s) => s.extractSubtree);
  const extractSubtreePreview = useTreeStore((s) => s.extractSubtreePreview);
  const fetchTreeMembers = useTreeStore((s) => s.fetchTreeMembers);
  const extractPct = useJobStore((s) => s.activeJobPct);

  const [name, setName] = useState("");
  const [rootMemberId, setRootMemberId] = useState<string | null>(null);
  const [direction, setDirection] = useState<SubtreeExtractDirection>(
    "direct_family",
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [preview, setPreview] = useState<SubtreeExtractPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!tree) return;
    setName(`${tree.name} ${t("name-suffix")}`);
    setRootMemberId(null);
    setDirection("direct_family");
    setPreview(null);

    // Load members for the picker via store action (never call TreeService directly).
    fetchTreeMembers(tree.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [tree, t, fetchTreeMembers]);

  // Fetch a preview whenever the selection is complete enough to evaluate.
  useEffect(() => {
    if (!tree || !rootMemberId) {
      setPreview(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setIsLoadingPreview(true);
    void (async () => {
      try {
        const result = await extractSubtreePreview({
          source_tree_id: tree.id,
          root_member_id: rootMemberId,
          direction,
        });
        if (ac.signal.aborted) return;
        setPreview(result);
      } catch (e) {
        if (ac.signal.aborted) return;
        console.error("Extract sub-tree preview failed", e);
        setPreview(null);
      } finally {
        if (!ac.signal.aborted) setIsLoadingPreview(false);
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, rootMemberId, direction]);

  const handleClose = () => {
    if (isExtracting) return;
    onClose();
  };

  const handleExtract = async () => {
    if (!tree) return;
    if (!name.trim()) {
      toast.error(t("toast-error-name"));
      return;
    }
    if (!rootMemberId) {
      toast.error(t("toast-error-no-root"));
      return;
    }

    setIsExtracting(true);
    try {
      await extractSubtree({
        name: name.trim(),
        source_tree_id: tree.id,
        root_member_id: rootMemberId,
        direction,
      });
      toast.success(t("toast-success"));
      onClose();
    } catch (e) {
      console.error("Extract sub-tree failed", e);
      toast.error(t("toast-error"));
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <Dialog open={!!tree} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: tree?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 px-1">
          <div className="space-y-2">
            <FieldLabel htmlFor="extract-subtree-name">
              {t("name-label")}
            </FieldLabel>
            <Input
              id="extract-subtree-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleExtract();
              }}
            />
          </div>

          <div className="space-y-2">
            <FieldLabel>{t("root-label")}</FieldLabel>
            <MemberPicker
              members={members}
              value={rootMemberId}
              onChange={setRootMemberId}
              placeholder={t("root-placeholder")}
              noResultsText={t("root-no-results")}
              size="default"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel>{t("direction-label")}</FieldLabel>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as SubtreeExtractDirection)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct_family">
                  {t("direction-direct-family")}
                </SelectItem>
                <SelectItem value="partnership">
                  {t("direction-partnership")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {direction === "direct_family"
                ? t("direction-direct-family-hint")
                : t("direction-partnership-hint")}
            </p>
          </div>

          {isLoadingPreview && (
            <p className="text-sm text-muted-foreground">
              {t("loading-preview")}
            </p>
          )}

          {preview && !isLoadingPreview && (
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="text-muted-foreground">
                {t("preview-members-move", { count: preview.member_count })}
              </div>
              <div className="text-muted-foreground">
                {t("preview-relations-kept", {
                  count: preview.relation_count,
                })}
              </div>
              <div className="text-muted-foreground">
                {t("preview-media-bytes", {
                  size: formatFileSize(preview.media_bytes),
                })}
              </div>
              {preview.severed_relation_count > 0 && (
                <Alert className="bg-transparent border-none p-0">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-sm mb-1">
                    {t("preview-severed-title")}
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    {t("preview-severed-description", {
                      count: preview.severed_relation_count,
                    })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
        {isExtracting && (
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300 ease-in-out"
              style={{ width: `${extractPct}%` }}
            />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isExtracting}
            >
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleExtract}
            disabled={isExtracting || !name.trim() || !rootMemberId}
          >
            {isExtracting ? t("moving") : t("move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
