import { useEffect, useState } from "react";
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
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Member } from "@/types/member";
import { Tree } from "@/types/tree";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Direction = "descendants" | "ancestors" | "both";

type Props = {
  tree: Tree | null;
  onClose: () => void;
};

export const ExtractSubtreeDialog = ({ tree, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.extract-subtree",
  });
  const extractSubtree = useTreeStore((s) => s.extractSubtree);
  const fetchTreeMembers = useTreeStore((s) => s.fetchTreeMembers);
  const extractPct = useJobStore((s) => s.activeJobPct);

  const [name, setName] = useState("");
  const [rootMemberId, setRootMemberId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("descendants");
  const [depthInput, setDepthInput] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    if (!tree) return;
    setName(`${tree.name} ${t("name-suffix")}`);
    setRootMemberId(null);
    setDirection("descendants");
    setDepthInput("");

    // Load members for the picker via store action (never call TreeService directly).
    fetchTreeMembers(tree.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [tree, t, fetchTreeMembers]);

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

    const depth = depthInput.trim() !== "" ? parseInt(depthInput, 10) : null;

    setIsExtracting(true);
    try {
      await extractSubtree({
        name: name.trim(),
        source_tree_id: tree.id,
        root_member_id: rootMemberId,
        direction,
        depth,
        include_partners: true,
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
            />
          </div>

          <div className="space-y-2">
            <FieldLabel>{t("direction-label")}</FieldLabel>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as Direction)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="descendants">
                  {t("direction-descendants")}
                </SelectItem>
                <SelectItem value="ancestors">
                  {t("direction-ancestors")}
                </SelectItem>
                <SelectItem value="both">{t("direction-both")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="extract-subtree-depth">
              {t("depth-label")}
            </FieldLabel>
            <Input
              id="extract-subtree-depth"
              type="number"
              min={0}
              value={depthInput}
              onChange={(e) => setDepthInput(e.target.value)}
              placeholder={t("depth-hint")}
            />
          </div>
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
            {isExtracting ? t("extracting") : t("extract")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
