import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Mars, Venus, VenusAndMars } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMemberStore } from "@/hooks/useMemberStore";
import { formatDate as formatLocaleDate } from "@/utils/dateUtils";
import type { Member, MemberUpdate, Gender } from "@/types/member";
import type { ListColumnId } from "./columns";

interface EditableCellProps {
  member: Member;
  columnId: ListColumnId;
}

type CellCategory = "text" | "gender" | "date";

function getCellCategory(columnId: ListColumnId): CellCategory | null {
  switch (columnId) {
    case "firstName":
    case "lastName":
    case "maidenName":
    case "birthplace":
    case "hometown":
    case "cemetery":
      return "text";
    case "gender":
      return "gender";
    case "birth":
    case "death":
      return "date";
    default:
      return null;
  }
}

function getTextValue(member: Member, columnId: ListColumnId): string | null {
  switch (columnId) {
    case "firstName":
      return member.firstName;
    case "lastName":
      return member.lastName;
    case "maidenName":
      return member.maidenName ?? null;
    case "birthplace":
      return member.birthplace ?? null;
    case "hometown":
      return member.hometown ?? null;
    case "cemetery":
      return member.cemetery ?? null;
    default:
      return null;
  }
}

function isRequiredTextField(columnId: ListColumnId): boolean {
  return columnId === "firstName" || columnId === "lastName";
}

function buildChanges(
  columnId: ListColumnId,
  draft: string | null,
): MemberUpdate {
  switch (columnId) {
    case "firstName":
      return { firstName: draft ?? "" };
    case "lastName":
      return { lastName: draft ?? "" };
    case "maidenName":
      return { maidenName: draft || null };
    case "birthplace":
      return { birthplace: draft || null };
    case "hometown":
      return { hometown: draft || null };
    case "cemetery":
      return { cemetery: draft || null };
    case "birth":
      return { dateOfBirth: draft ?? "" };
    case "death":
      return { dateOfDeath: draft };
    default:
      return {};
  }
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  return formatLocaleDate(dateString);
}

export function EditableCell({ member, columnId }: EditableCellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "list-view.view" });
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: "common" });
  const { updateMemberPartial } = useMemberStore();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const category = getCellCategory(columnId);

  // ── TEXT state ──────────────────────────────────────────────────────────────
  const textOriginal =
    category === "text" ? (getTextValue(member, columnId) ?? null) : null;
  const [textDraft, setTextDraft] = useState<string>("");

  // ── DATE state ──────────────────────────────────────────────────────────────
  const dateOriginal =
    columnId === "birth"
      ? member.date.birth || null
      : columnId === "death"
        ? (member.date.death ?? null)
        : null;
  const [dateDraft, setDateDraft] = useState<string | null>(null);

  // ── GENDER state ─────────────────────────────────────────────────────────────
  const genderOriginal = member.gender;
  const [genderDraft, setGenderDraft] = useState<Gender>(genderOriginal);

  const dateContainerRef = useRef<HTMLDivElement>(null);

  if (!category) {
    // Non-editable column — render nothing special (parent shouldn't reach here)
    return null;
  }

  // ── Commit helper ────────────────────────────────────────────────────────────
  const commit = async (changes: MemberUpdate) => {
    setSaving(true);
    try {
      await updateMemberPartial(member.id, changes);
      setEditing(false);
    } catch {
      // Revert drafts to original values
      setTextDraft(textOriginal ?? "");
      setDateDraft(dateOriginal);
      setGenderDraft(genderOriginal);
      toast.error(t("inline-edit.save-error"));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  // ── TEXT handlers ────────────────────────────────────────────────────────────
  const enterTextEdit = () => {
    setTextDraft(textOriginal ?? "");
    setEditing(true);
  };

  const commitText = async () => {
    const trimmed = textDraft.trim();
    const originalStr = textOriginal ?? "";

    // Required field: never clear
    if (isRequiredTextField(columnId) && trimmed === "") {
      setEditing(false);
      return;
    }

    // No-op: no change
    const newVal = isRequiredTextField(columnId) ? trimmed : textDraft || null;
    const compareNew = typeof newVal === "string" ? newVal : "";
    if (compareNew === originalStr) {
      setEditing(false);
      return;
    }

    await commit(buildChanges(columnId, newVal));
  };

  const cancelText = () => {
    setTextDraft(textOriginal ?? "");
    setEditing(false);
  };

  // ── DATE handlers ────────────────────────────────────────────────────────────
  const enterDateEdit = () => {
    setDateDraft(dateOriginal);
    setEditing(true);
  };

  const commitDate = async () => {
    // Required birth date: never clear
    if (columnId === "birth" && !dateDraft) {
      setEditing(false);
      return;
    }

    // No-op check
    const original = dateOriginal ?? null;
    const current = dateDraft ?? null;
    if (current === original) {
      setEditing(false);
      return;
    }

    await commit(buildChanges(columnId, dateDraft));
  };

  const cancelDate = () => {
    setDateDraft(dateOriginal);
    setEditing(false);
  };

  const handleDateContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // Only commit if focus is truly leaving this container (handles portaled popovers)
    if (
      dateContainerRef.current &&
      e.relatedTarget instanceof Node &&
      dateContainerRef.current.contains(e.relatedTarget)
    ) {
      return;
    }
    // Also ignore if relatedTarget is in a portal (not inside our container but part of the picker)
    if (e.relatedTarget instanceof Element) {
      const closest = e.relatedTarget.closest(
        "[data-radix-popper-content-wrapper]",
      );
      if (closest) return;
    }
    void commitDate();
  };

  // ── GENDER handlers ──────────────────────────────────────────────────────────
  const enterGenderEdit = () => {
    setGenderDraft(genderOriginal);
    setEditing(true);
  };

  const commitGender = async (val: string) => {
    const newGender = val as Gender;
    setGenderDraft(newGender);
    if (newGender === genderOriginal) {
      setEditing(false);
      return;
    }
    await commit({ gender: newGender });
  };

  const cancelGender = () => {
    setGenderDraft(genderOriginal);
    setEditing(false);
  };

  // ── Saving spinner ───────────────────────────────────────────────────────────
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("inline-edit.saving")}
      </span>
    );
  }

  // ── TEXT render ──────────────────────────────────────────────────────────────
  if (category === "text") {
    const displayVal = textOriginal || "-";
    if (!editing) {
      return (
        <button
          type="button"
          className="w-full text-left px-1 py-0.5 rounded border border-dashed border-transparent hover:border-border hover:bg-muted/40 transition-colors text-sm"
          onClick={enterTextEdit}
        >
          {columnId === "firstName" ? (
            <span className="font-medium">{displayVal}</span>
          ) : (
            displayVal
          )}
        </button>
      );
    }
    return (
      <Input
        autoFocus
        className="h-7 text-xs px-1"
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        onBlur={() => void commitText()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commitText();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelText();
          }
        }}
      />
    );
  }

  // ── GENDER render ────────────────────────────────────────────────────────────
  if (category === "gender") {
    const GenderDisplayIcon = () => {
      const size = 20;
      switch (genderOriginal) {
        case "m":
          return <Mars size={size} aria-hidden="true" />;
        case "f":
          return <Venus size={size} aria-hidden="true" />;
        default:
          return <VenusAndMars size={size} aria-hidden="true" />;
      }
    };

    if (!editing) {
      return (
        <button
          type="button"
          className="inline-flex items-center gap-1 px-1 py-0.5 rounded border border-dashed border-transparent hover:border-border hover:bg-muted/40 transition-colors"
          aria-label={t("inline-edit.gender-aria")}
          onClick={enterGenderEdit}
        >
          <GenderDisplayIcon />
          <span className="sr-only">{tCommon(`gender.${genderOriginal}`)}</span>
        </button>
      );
    }

    return (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={genderDraft}
        onValueChange={(val) => {
          if (val) {
            void commitGender(val);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancelGender();
          }
        }}
        onBlur={(e) => {
          if (
            e.currentTarget &&
            e.relatedTarget instanceof Node &&
            e.currentTarget.contains(e.relatedTarget)
          ) {
            return;
          }
          cancelGender();
        }}
        className="justify-start"
        aria-label={t("inline-edit.gender-aria")}
      >
        <ToggleGroupItem
          value="m"
          aria-label={tCommon("gender.m")}
          className="h-7 min-w-7 text-xs"
        >
          <Mars />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="f"
          aria-label={tCommon("gender.f")}
          className="h-7 min-w-7 text-xs"
        >
          <Venus />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="o"
          aria-label={tCommon("gender.o")}
          className="h-7 min-w-7 text-xs"
        >
          <VenusAndMars />
        </ToggleGroupItem>
      </ToggleGroup>
    );
  }

  // ── DATE render ──────────────────────────────────────────────────────────────
  const displayDate = formatDate(dateOriginal);
  if (!editing) {
    return (
      <button
        type="button"
        className="w-full text-left px-1 py-0.5 rounded border border-dashed border-transparent hover:border-border hover:bg-muted/40 transition-colors text-sm"
        onClick={enterDateEdit}
      >
        {displayDate}
      </button>
    );
  }

  return (
    <div
      ref={dateContainerRef}
      onBlur={handleDateContainerBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commitDate();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelDate();
        }
      }}
    >
      <PartialDatePicker
        value={dateDraft}
        onChange={(val) => setDateDraft(val)}
      />
    </div>
  );
}
