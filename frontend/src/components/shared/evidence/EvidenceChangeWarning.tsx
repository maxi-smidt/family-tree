import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCitationStore } from "@/hooks/useCitationStore";
import { CitableField } from "@/types/citation";
import { formatDate } from "@/utils/dateUtils";

type Props = {
  memberId: string;
  field: CitableField;
  /** The value when editing started, which the evidence was cited for. */
  baseline: string;
  /** The value in the form now. */
  value: string;
  onUndo: () => void;
};

/** When a field with evidence gets a new value, ask whether the evidence
 *  still supports it: keep it, remove it from this field, or undo the
 *  change. */
export const EvidenceChangeWarning = ({
  memberId,
  field,
  baseline,
  value,
  onUndo,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.evidence.changed",
  });
  const all = useCitationStore((s) => s.citations);
  const removeCitation = useCitationStore((s) => s.removeCitation);
  const citations = useMemo(
    () => all.filter((c) => c.memberId === memberId && c.field === field),
    [all, memberId, field],
  );
  const [dismissed, setDismissed] = useState(false);
  const [removing, setRemoving] = useState(false);

  // A new editing session (another value saved as the start) asks again.
  useEffect(() => setDismissed(false), [baseline]);

  if (dismissed || citations.length === 0 || value === baseline) return null;

  const isDate = field === "date_of_birth" || field === "date_of_death";
  const shown = baseline ? (isDate ? formatDate(baseline) : baseline) : null;
  const quoted = citations.find((c) => c.quote);

  const remove = async () => {
    setRemoving(true);
    try {
      for (const citation of citations) await removeCitation(citation.id);
      setDismissed(true);
    } catch {
      toast.error(t("error-remove"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      role="status"
      className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] leading-snug text-warning"
    >
      <p className="font-semibold">
        {shown
          ? t("title", { count: citations.length, value: shown })
          : t("title-empty", { count: citations.length })}
      </p>
      <p className="mt-0.5">
        {quoted?.quote
          ? t("quote", { quote: quoted.quote })
          : t("question", { count: citations.length })}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 bg-card text-xs shadow-none"
          onClick={() => setDismissed(true)}
        >
          {t("keep")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 bg-card text-xs shadow-none"
          disabled={removing}
          onClick={() => void remove()}
        >
          {t("remove")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-primary hover:text-primary"
          onClick={onUndo}
        >
          {t("undo")}
        </Button>
      </div>
    </div>
  );
};
