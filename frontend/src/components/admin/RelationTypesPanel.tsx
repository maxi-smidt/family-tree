import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminService } from "@/services/AdminService";
import { PARENT_RELATION_TYPE, RelationTypeDB } from "@/types/member";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Mirrors the backend id rule (RelationTypeCreate): ids double as i18n keys.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const RelationTypesPanel = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.relation-types" });
  const { t: tRelation } = useTranslation(undefined, {
    keyPrefix: "common.relation-types",
  });
  const [types, setTypes] = useState<RelationTypeDB[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newType, setNewType] = useState({ id: "", description: "" });

  const load = async () => {
    try {
      setTypes(await AdminService.listRelationTypes());
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncStore = () => useTreeStore.getState().refreshRelationTypes();

  const handleCreate = async () => {
    try {
      await AdminService.createRelationType(
        newType.id,
        newType.description || null,
      );
      setNewType({ id: "", description: "" });
      await load();
      await syncStore();
      toast.success(t("created"));
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  const handleSaveDescription = async (type: RelationTypeDB) => {
    try {
      await AdminService.updateRelationType(type.id, drafts[type.id] || null);
      setDrafts(({ [type.id]: _saved, ...rest }) => rest);
      await load();
      toast.success(t("saved"));
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  const handleDelete = async (type: RelationTypeDB) => {
    try {
      await AdminService.deleteRelationType(type.id);
      await load();
      await syncStore();
      toast.success(t("deleted"));
    } catch (err) {
      console.error(err);
      // The backend rejects deleting "parent" or any type still in use.
      toast.error(t("delete-error"));
    }
  };

  const validNewId = ID_PATTERN.test(newType.id) && newType.id.length <= 50;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col-id")}</TableHead>
              <TableHead>{t("col-label")}</TableHead>
              <TableHead>{t("col-description")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => (
              <TableRow key={type.id}>
                <TableCell className="font-mono text-xs">{type.id}</TableCell>
                <TableCell>
                  {tRelation(type.id, {
                    defaultValue: type.description ?? type.id,
                  })}
                </TableCell>
                <TableCell>
                  <Input
                    value={drafts[type.id] ?? type.description ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [type.id]: e.target.value }))
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {drafts[type.id] !== undefined &&
                      drafts[type.id] !== (type.description ?? "") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("save-description")}
                          aria-label={t("save-description")}
                          onClick={() => handleSaveDescription(type)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                    <Button
                      variant="ghost"
                      size="sm"
                      title={
                        type.id === PARENT_RELATION_TYPE
                          ? t("delete-parent-unavailable")
                          : t("delete")
                      }
                      aria-label={t("delete")}
                      disabled={type.id === PARENT_RELATION_TYPE}
                      onClick={() => handleDelete(type)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end border-t pt-4">
        <div className="space-y-1">
          <FieldLabel htmlFor="nrt-id">{t("col-id")}</FieldLabel>
          <Input
            id="nrt-id"
            value={newType.id}
            placeholder={t("id-placeholder")}
            onChange={(e) =>
              setNewType({ ...newType, id: e.target.value.toLowerCase() })
            }
          />
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor="nrt-description">
            {t("col-description")}
          </FieldLabel>
          <Input
            id="nrt-description"
            value={newType.description}
            onChange={(e) =>
              setNewType({ ...newType, description: e.target.value })
            }
          />
        </div>
        <Button onClick={handleCreate} disabled={!validNewId}>
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>
    </div>
  );
};
