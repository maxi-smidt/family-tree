/**
 * MergeConflictResolver — shows a side-by-side card for a single duplicate
 * pair and lets the user choose: merge vs keep both, and per-field choices
 * (Use A / Use B / Combine) for conflicting fields.
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberDB } from "@/types/member";
import { DuplicatePair, MergeFieldChoice } from "@/types/merge";
import {
  COMBINABLE_FIELDS,
  RESOLVABLE_FIELDS,
  PairResolutionState,
  getMemberField,
  isFieldConflicting,
  memberDisplayName,
} from "@/utils/mergeUtils";

interface Props {
  pair: DuplicatePair;
  sourceAName: string;
  sourceBName: string;
  state: PairResolutionState;
  onChange: (updated: PairResolutionState) => void;
}

function FieldRow({
  field,
  memberA,
  memberB,
  isConflict,
  action,
  fieldChoice,
  onChoiceChange,
  sourceAName,
  sourceBName,
}: {
  field: string;
  memberA: MemberDB;
  memberB: MemberDB;
  isConflict: boolean;
  action: "merge" | "keep_both";
  fieldChoice: MergeFieldChoice | undefined;
  onChoiceChange: (choice: MergeFieldChoice) => void;
  sourceAName: string;
  sourceBName: string;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "merge-view.resolve",
  });

  const va = getMemberField(memberA, field);
  const vb = getMemberField(memberB, field);

  const displayA = va || "—";
  const displayB = vb || "—";
  const isCombinableField = COMBINABLE_FIELDS.includes(field);

  return (
    <div
      className={`grid grid-cols-[1fr_1fr_auto] gap-2 items-start py-2 px-3 rounded-sm ${
        isConflict
          ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
          : "bg-muted/30"
      }`}
    >
      {/* Source A value */}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">
          {sourceAName}
        </div>
        <div className="text-sm break-words">{displayA}</div>
      </div>

      {/* Source B value */}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">
          {sourceBName}
        </div>
        <div className="text-sm break-words">{displayB}</div>
      </div>

      {/* Choice selector (only shown when merging and there's a real conflict) */}
      <div className="w-28">
        {isConflict && action === "merge" ? (
          <Select
            value={fieldChoice ?? "a"}
            onValueChange={(v) => onChoiceChange(v as MergeFieldChoice)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">{t("field-choice-a")}</SelectItem>
              <SelectItem value="b">{t("field-choice-b")}</SelectItem>
              {isCombinableField && (
                <SelectItem value="combine">
                  {t("field-choice-combine")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {isConflict ? "—" : t("no-conflict")}
          </span>
        )}
      </div>
    </div>
  );
}

export const MergeConflictResolver = ({
  pair,
  sourceAName,
  sourceBName,
  state,
  onChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "merge-view.resolve",
  });

  const handleActionChange = (action: "merge" | "keep_both") => {
    onChange({ ...state, action });
  };

  const handleFieldChoice = (field: string, choice: MergeFieldChoice) => {
    onChange({
      ...state,
      fields: { ...state.fields, [field]: choice },
    });
  };

  // Only show fields that have at least one non-empty value in either member
  const visibleFields = RESOLVABLE_FIELDS.filter((field) => {
    const va = getMemberField(pair.member_a, field);
    const vb = getMemberField(pair.member_b, field);
    return (va || "").trim() || (vb || "").trim();
  });

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Header: member names + match badge + action toggle */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 bg-muted/50 border-b">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-medium text-sm truncate">
            {memberDisplayName(pair.member_a)}
          </span>
          <Badge
            variant={pair.match === "exact" ? "destructive" : "secondary"}
            className="shrink-0 text-xs"
          >
            {pair.match === "exact" ? t("badge-exact") : t("badge-possible")}
          </Badge>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-xs text-muted-foreground">{t("action-label")}</Label>
          <Select
            value={state.action}
            onValueChange={(v) =>
              handleActionChange(v as "merge" | "keep_both")
            }
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merge">{t("action-merge")}</SelectItem>
              <SelectItem value="keep_both">{t("action-keep-both")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-1.5 bg-background border-b">
        <div className="text-xs font-medium text-muted-foreground">
          {sourceAName}
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          {sourceBName}
        </div>
        <div className="w-28 text-xs font-medium text-muted-foreground">
          {state.action === "merge" ? t("column-choice") : ""}
        </div>
      </div>

      {/* Field rows */}
      <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
        {visibleFields.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("no-visible-fields")}
          </p>
        ) : (
          visibleFields.map((field) => (
            <FieldRow
              key={field}
              field={field}
              memberA={pair.member_a}
              memberB={pair.member_b}
              isConflict={isFieldConflicting(pair, field)}
              action={state.action}
              fieldChoice={state.fields[field]}
              onChoiceChange={(choice) => handleFieldChoice(field, choice)}
              sourceAName={sourceAName}
              sourceBName={sourceBName}
            />
          ))
        )}
      </div>
    </div>
  );
};
