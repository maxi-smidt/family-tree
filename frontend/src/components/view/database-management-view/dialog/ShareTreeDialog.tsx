import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import { api } from "@/services/api";
import { Database, TreeAccess } from "@/types/database";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  tree: Database;
  isOpen: boolean;
  onClose: () => void;
};

export const ShareTreeDialog = ({ tree, isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.share-tree" });
  const [access, setAccess] = useState<TreeAccess[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");

  const loadAccess = useCallback(async () => {
    setAccess(await api.get<TreeAccess[]>(`/trees/${tree.id}/access`));
  }, [tree.id]);

  useEffect(() => {
    if (isOpen) void loadAccess();
  }, [isOpen, loadAccess]);

  const handleShare = async () => {
    try {
      const updated = await api.post<TreeAccess[]>(`/trees/${tree.id}/access`, {
        username,
        role,
      });
      setAccess(updated);
      setUsername("");
      toast.success(t("shared"));
    } catch (err) {
      console.error(err);
      toast.error(t("share-error"));
    }
  };

  const handleRevoke = async (userId: string) => {
    try {
      await api.del(`/trees/${tree.id}/access/${userId}`);
      await loadAccess();
    } catch (err) {
      console.error(err);
      toast.error(t("revoke-error"));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { name: tree.name })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {access.map((a) => (
            <div
              key={a.user_id}
              className="flex items-center justify-between rounded-md border p-2"
            >
              <span className="text-sm font-medium">{a.username}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{t(`role-${a.role}`)}</Badge>
                {a.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(a.user_id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2 border-t pt-4">
          <Input
            placeholder={t("username-placeholder")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1"
          />
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">{t("role-editor")}</SelectItem>
              <SelectItem value="viewer">{t("role-viewer")}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleShare} disabled={!username}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
