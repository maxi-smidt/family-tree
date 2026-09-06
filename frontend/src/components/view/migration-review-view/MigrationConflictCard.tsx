import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/dateUtils";
import { useMigrationReviewStore } from "@/hooks/useMigrationReviewStore";
import { MergeFieldChoice } from "@/types/merge";
import {
  MigrationConflictAction,
  MigrationConflictDB,
} from "@/types/migration";

// Mirrors app.services.migration.converter._BRIDGE_DRIFT_FIELDS.
const FIELD_LABEL_KEY: Record<string, string> = {
  gender: "field-gender",
  academic_title: "field-academic-title",
  first_name: "field-first-name",
  middle_names: "field-middle-names",
  baptismal_name: "field-baptismal-name",
  last_name: "field-last-name",
  maiden_name: "field-maiden-name",
  date_of_birth: "field-date-of-birth",
  date_of_death: "field-date-of-death",
  deceased: "field-deceased",
  adopted: "field-adopted",
  additional_data: "field-additional-data",
  birthplace: "field-birthplace",
  hometown: "field-hometown",
  cemetery: "field-cemetery",
  places_lived: "field-places-lived",
};

const COMBINABLE_FIELDS = new Set(["additional_data", "places_lived"]);

// A cycle detected while collapsing a bridge pair: nothing to merge
// field-by-field (both rows stayed live), so it's flagged rather than
// listed among the normal field rows — see converter.py's "cycle" outcome.
const CYCLE_SENTINEL = "__cycle__";

interface Props {
  conflict: MigrationConflictDB;
}

export const MigrationConflictCard = ({ conflict }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view.checklist",
  });
  const { t: tMerge } = useTranslation(undefined, {
    keyPrefix: "merge-view.resolve",
  });
  const resolveConflict = useMigrationReviewStore((s) => s.resolveConflict);

  const isBridgeMerge = conflict.kind === "bridge_merge";
  const isCycle = conflict.conflicting_fields.includes(CYCLE_SENTINEL);
  const fieldRows = conflict.conflicting_fields.filter(
    (f) => f !== CYCLE_SENTINEL,
  );
  const hasPhotoConflict = conflict.conflicting_media.length > 0;
  const isPending = conflict.status === "pending";

  const [action, setAction] = useState<MigrationConflictAction>(
    isCycle ? "keep_both" : "merge",
  );
  const [fields, setFields] = useState<
    Partial<Record<string, MergeFieldChoice>>
  >({});
  const [submitting, setSubmitting] = useState(false);

  const setFieldChoice = (field: string, choice: MergeFieldChoice) =>
    setFields((prev) => ({ ...prev, [field]: choice }));

  // Selects fall back to displaying "a" when nothing's been chosen yet, but
  // that's a render-time default, not state — an untouched select must
  // still submit "a" explicitly, or an all-defaults merge would send empty
  // fields and silently resolve the conflict without applying any value.
  const effectiveFields = (): Partial<Record<string, MergeFieldChoice>> => {
    const result: Partial<Record<string, MergeFieldChoice>> = {};
    for (const field of fieldRows) result[field] = fields[field] ?? "a";
    if (hasPhotoConflict) result.image_data = fields.image_data ?? "a";
    return result;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await resolveConflict(conflict.id, {
        action,
        fields: action === "merge" ? effectiveFields() : {},
      });
    } catch {
      toast.error(t("resolve-error"));
    } finally {
      setSubmitting(false);
    }
  };

  const statusVariant =
    conflict.status === "resolved"
      ? "default"
      : conflict.status === "dismissed"
        ? "secondary"
        : "outline";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">
            {isBridgeMerge
              ? t("kind-bridge-merge")
              : t("kind-virtual-view-match")}
          </Badge>
          {isPending && conflict.blocks_finalization && (
            <Badge variant="destructive">{t("blocks-finalization")}</Badge>
          )}
        </div>
        <Badge variant={statusVariant}>{t(`status-${conflict.status}`)}</Badge>
      </div>

      {isPending ? (
        <>
          {isCycle && (
            <p className="text-sm text-muted-foreground bg-muted/30 rounded-sm px-3 py-2">
              {t("cycle-notice")}
            </p>
          )}

          {isBridgeMerge && (fieldRows.length > 0 || hasPhotoConflict) && (
            <div className="space-y-1.5">
              {fieldRows.map((field) => {
                const values = conflict.field_values[field] ?? {};
                const valueA = String(values[conflict.member_a_id] ?? "—");
                const valueB = String(values[conflict.member_b_id] ?? "—");
                const combinable = COMBINABLE_FIELDS.has(field);
                return (
                  <div
                    key={field}
                    className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center rounded-sm bg-muted/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {t(FIELD_LABEL_KEY[field] ?? "field-unknown")}
                      </p>
                      <p className="text-sm break-words">{valueA}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">&nbsp;</p>
                      <p className="text-sm break-words">{valueB}</p>
                    </div>
                    <div className="w-28">
                      {action === "merge" ? (
                        <Select
                          value={fields[field] ?? "a"}
                          onValueChange={(v) =>
                            setFieldChoice(field, v as MergeFieldChoice)
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="a">
                              {tMerge("field-choice-a")}
                            </SelectItem>
                            <SelectItem value="b">
                              {tMerge("field-choice-b")}
                            </SelectItem>
                            {combinable && (
                              <SelectItem value="combine">
                                {tMerge("field-choice-combine")}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {hasPhotoConflict && (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center rounded-sm bg-muted/30 px-3 py-2">
                  <p className="text-sm col-span-2">{t("field-photo")}</p>
                  <div className="w-28">
                    {action === "merge" ? (
                      <Select
                        value={fields.image_data ?? "a"}
                        onValueChange={(v) =>
                          setFieldChoice("image_data", v as MergeFieldChoice)
                        }
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="a">
                            {tMerge("field-choice-a")}
                          </SelectItem>
                          <SelectItem value="b">
                            {tMerge("field-choice-b")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                {tMerge("action-label")}
              </Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as MigrationConflictAction)}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!isCycle && (
                    <SelectItem value="merge">
                      {tMerge("action-merge")}
                    </SelectItem>
                  )}
                  <SelectItem value="keep_both">
                    {tMerge("action-keep-both")}
                  </SelectItem>
                  <SelectItem value="dismiss">{t("action-dismiss")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              {t("resolve")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {conflict.resolved_at &&
            t("resolved-on", { date: formatDate(conflict.resolved_at) })}
        </p>
      )}
    </Card>
  );
};
