import { useEffect, useState } from "react";
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
import { resolveRelationLabel } from "@/utils/relationLabelUtils";
import {
  RELATION_DASH_OPTIONS,
  relationStyleOverrideFromType,
  resolveRelationStyle,
  toColorInputValue,
} from "@/utils/relationStyleUtils";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Mirrors the backend id rule (RelationTypeCreate): ids double as i18n keys.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

interface StylePreviewProps {
  stroke: string;
  strokeDasharray: string;
  strokeWidth: number;
}

function StylePreview({
  stroke,
  strokeDasharray,
  strokeWidth,
}: StylePreviewProps) {
  return (
    <svg
      width="48"
      height="16"
      viewBox="0 0 48 16"
      aria-hidden="true"
      className="inline-block align-middle"
    >
      <line
        x1="2"
        y1="8"
        x2="46"
        y2="8"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray === "0" ? undefined : strokeDasharray}
      />
    </svg>
  );
}

export const RelationTypesPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "admin.relation-types",
  });
  const { t: tRelation } = useTranslation(undefined, {
    keyPrefix: "common.relation-types",
  });
  const [types, setTypes] = useState<RelationTypeDB[]>([]);
  // Per-row dirty field tracking
  const [drafts, setDrafts] = useState<Record<string, Partial<RelationTypeDB>>>(
    {},
  );
  const [newType, setNewType] = useState({
    id: "",
    description: "",
    label: "",
    color: "",
    stroke_dasharray: "",
    stroke_width: "",
  });

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

  const syncStore = () => useWorkspaceStore.getState().refreshRelationTypes();

  // Build the patch payload from dirty fields only
  const getDirtyFields = (
    type: RelationTypeDB,
  ): Partial<Omit<RelationTypeDB, "id">> => {
    const d = drafts[type.id] ?? {};
    const result: Partial<Omit<RelationTypeDB, "id">> = {};
    if ("description" in d) result.description = d.description ?? null;
    if ("label" in d) result.label = d.label ?? null;
    if ("color" in d) result.color = d.color ?? null;
    if ("stroke_width" in d) result.stroke_width = d.stroke_width ?? null;
    if ("stroke_dasharray" in d)
      result.stroke_dasharray = d.stroke_dasharray ?? null;
    return result;
  };

  const hasDirtyFields = (type: RelationTypeDB): boolean => {
    const d = drafts[type.id] ?? {};
    if (Object.keys(d).length === 0) return false;
    // Compare draft values against saved values
    for (const [key, draftVal] of Object.entries(d)) {
      const savedVal = type[key as keyof RelationTypeDB];
      if ((draftVal ?? null) !== (savedVal ?? null)) return true;
    }
    return false;
  };

  const setDraftField = (
    typeId: string,
    field: keyof Omit<RelationTypeDB, "id">,
    value: string | number | null,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [typeId]: { ...prev[typeId], [field]: value },
    }));
  };

  const getEffectiveType = (type: RelationTypeDB): RelationTypeDB => {
    const d = drafts[type.id] ?? {};
    return {
      ...type,
      description:
        "description" in d ? (d.description ?? null) : type.description,
      label: "label" in d ? (d.label ?? null) : type.label,
      color: "color" in d ? (d.color ?? null) : type.color,
      stroke_dasharray:
        "stroke_dasharray" in d
          ? (d.stroke_dasharray ?? null)
          : type.stroke_dasharray,
      stroke_width:
        "stroke_width" in d ? (d.stroke_width ?? null) : type.stroke_width,
    };
  };

  const hasStyleOverride = (
    type: RelationTypeDB,
    field: "color" | "stroke_dasharray" | "stroke_width",
  ): boolean => {
    const d = drafts[type.id] ?? {};
    return (field in d ? d[field] : type[field]) != null;
  };

  const handleSave = async (type: RelationTypeDB) => {
    try {
      const dirty = getDirtyFields(type);
      await AdminService.updateRelationType(type.id, dirty);
      setDrafts(({ [type.id]: _saved, ...rest }) => rest);
      await load();
      await syncStore();
      toast.success(t("saved"));
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  const handleCreate = async () => {
    const parsedWidth = newType.stroke_width
      ? parseFloat(newType.stroke_width)
      : null;
    try {
      await AdminService.createRelationType({
        id: newType.id,
        description: newType.description || null,
        label: newType.label || null,
        color: newType.color || null,
        stroke_width: parsedWidth,
        stroke_dasharray: newType.stroke_dasharray || null,
      });
      setNewType({
        id: "",
        description: "",
        label: "",
        color: "",
        stroke_dasharray: "",
        stroke_width: "",
      });
      await load();
      await syncStore();
      toast.success(t("created"));
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
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col-id")}</TableHead>
              <TableHead>{t("col-label")}</TableHead>
              <TableHead>{t("col-description")}</TableHead>
              <TableHead>{t("col-color")}</TableHead>
              <TableHead>{t("col-pattern")}</TableHead>
              <TableHead>{t("col-width")}</TableHead>
              <TableHead>{t("col-style")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => {
              const effectiveType = getEffectiveType(type);
              const style = resolveRelationStyle(
                type.id,
                relationStyleOverrideFromType(effectiveType),
              );
              const descVal = effectiveType.description ?? "";
              const labelVal = effectiveType.label ?? "";
              const colorVal = toColorInputValue(
                effectiveType.color,
                style.colorInput,
              );
              const dashVal = style.strokeDasharray;
              const widthVal = String(style.strokeWidth);
              const hasKnownDashOption = RELATION_DASH_OPTIONS.some(
                (opt) => opt.value === dashVal,
              );

              return (
                <TableRow key={type.id}>
                  <TableCell className="font-mono text-xs">{type.id}</TableCell>
                  <TableCell>
                    <Input
                      value={labelVal}
                      placeholder={resolveRelationLabel(type, tRelation)}
                      onChange={(e) =>
                        setDraftField(type.id, "label", e.target.value || null)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={descVal}
                      onChange={(e) =>
                        setDraftField(
                          type.id,
                          "description",
                          e.target.value || null,
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <input
                        type="color"
                        value={colorVal}
                        aria-label={t("col-color")}
                        className="h-8 w-8 cursor-pointer rounded border p-0.5"
                        onChange={(e) =>
                          setDraftField(type.id, "color", e.target.value)
                        }
                      />
                      {hasStyleOverride(type, "color") && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          title={t("clear-color")}
                          aria-label={t("clear-color")}
                          onClick={() => setDraftField(type.id, "color", null)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Select
                        value={dashVal}
                        onValueChange={(v) =>
                          setDraftField(type.id, "stroke_dasharray", v)
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {!hasKnownDashOption && (
                            <SelectItem value={dashVal}>{dashVal}</SelectItem>
                          )}
                          {RELATION_DASH_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {hasStyleOverride(type, "stroke_dasharray") && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          title={t("clear-pattern")}
                          aria-label={t("clear-pattern")}
                          onClick={() =>
                            setDraftField(type.id, "stroke_dasharray", null)
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="w-[70px]"
                        value={widthVal}
                        min={0.5}
                        max={12}
                        step={0.5}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftField(
                            type.id,
                            "stroke_width",
                            v === "" ? null : parseFloat(v),
                          );
                        }}
                      />
                      {hasStyleOverride(type, "stroke_width") && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          title={t("clear-width")}
                          aria-label={t("clear-width")}
                          onClick={() =>
                            setDraftField(type.id, "stroke_width", null)
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StylePreview
                      stroke={style.stroke}
                      strokeDasharray={style.strokeDasharray}
                      strokeWidth={style.strokeWidth}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {hasDirtyFields(type) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("save-row")}
                          aria-label={t("save-row")}
                          onClick={() => handleSave(type)}
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-t pt-4">
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
          <FieldLabel htmlFor="nrt-label">{t("col-label")}</FieldLabel>
          <Input
            id="nrt-label"
            value={newType.label}
            placeholder={t("label-placeholder")}
            onChange={(e) => setNewType({ ...newType, label: e.target.value })}
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
