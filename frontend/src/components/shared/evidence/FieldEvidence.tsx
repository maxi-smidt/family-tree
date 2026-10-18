import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCheck,
  FileText,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCitationStore } from "@/hooks/useCitationStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { CitableField, MemberFieldCitation } from "@/types/citation";
import { Member } from "@/types/member";
import { CitationDialog } from "./CitationDialog";
import { CitationReader } from "./CitationReader";
import { useCanEditEvidence } from "./useCanEditEvidence";

type Props = {
  member: Member;
  field: CitableField;
  /** "badge" sits next to a field label; "input" next to a form input. */
  variant?: "badge" | "input";
  className?: string;
};

/** The documents cited for one field of a person: a count that opens the
 *  list, with "Add evidence" for people who may edit. Nothing shows to
 *  readers when a field has no evidence. */
export const FieldEvidence = ({
  member,
  field,
  variant = "badge",
  className,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.evidence" });
  const all = useCitationStore((s) => s.citations);
  const citations = useMemo(
    () => all.filter((c) => c.memberId === member.id && c.field === field),
    [all, member.id, field],
  );
  const canEdit = useCanEditEvidence();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MemberFieldCitation | null>(null);
  const [reading, setReading] = useState<MemberFieldCitation | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const anchorRef = useRef<HTMLSpanElement>(null);

  if (citations.length === 0 && !canEdit) return null;

  const fieldName = t(`field-lower.${field}`);
  const count = citations.length;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Portal into the sheet so its scroll lock doesn't swallow the list.
      setPortalContainer(
        anchorRef.current?.closest<HTMLElement>(
          '[data-slot="sheet-content"], [data-slot="dialog-content"]',
        ) ?? undefined,
      );
    }
    setOpen(next);
  };

  const startAdding = () => {
    setOpen(false);
    setAdding(true);
  };

  const trigger =
    count === 0 ? (
      <Button
        type="button"
        variant="outline"
        size={variant === "input" ? "icon-sm" : "icon-xs"}
        aria-label={t("add-for", { field: fieldName })}
        title={t("add-for", { field: fieldName })}
        className={cn(
          "shrink-0 border-dashed text-muted-foreground shadow-none",
          variant === "badge" &&
            "h-5 w-auto rounded-full px-1.5 text-[11px] font-medium opacity-0 group-hover/evidence:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100",
          className,
        )}
        onClick={startAdding}
      >
        <Plus className="size-3" />
        {variant === "badge" && t("add-short")}
      </Button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size={variant === "input" ? "sm" : "icon-xs"}
        aria-label={t("count-label", { field: fieldName, count: count })}
        title={t("count-label", { field: fieldName, count: count })}
        className={cn(
          "shrink-0 gap-1 bg-primary-soft text-primary hover:bg-primary-soft/80 hover:text-primary",
          variant === "badge"
            ? "h-[18px] w-auto rounded-full px-1.5 text-[11px] font-semibold"
            : "h-8 px-2 text-xs font-semibold",
          citations.some((c) => c.quoteFound === false) &&
            "bg-warning-soft text-warning hover:bg-warning-soft/80 hover:text-warning",
          className,
        )}
      >
        <FileCheck className="size-3" />
        {count}
      </Button>
    );

  return (
    <span ref={anchorRef} className="inline-flex">
      {count === 0 ? (
        trigger
      ) : (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="start"
            portalContainer={portalContainer}
            className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2.5 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {t("title", { field: fieldName })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("source-count", { count: count })}
              </p>
            </div>
            <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {citations.map((citation) => (
                <CitationCard
                  key={citation.id}
                  citation={citation}
                  canEdit={canEdit}
                  onRead={() => {
                    setOpen(false);
                    setReading(citation);
                  }}
                  onEdit={() => {
                    setOpen(false);
                    setEditing(citation);
                  }}
                />
              ))}
            </ul>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-dashed shadow-none"
                onClick={startAdding}
              >
                <Plus />
                {t("add")}
              </Button>
            )}
          </PopoverContent>
        </Popover>
      )}
      {(adding || editing) && (
        <CitationDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setAdding(false);
              setEditing(null);
            }
          }}
          memberId={member.id}
          field={field}
          citation={editing ?? undefined}
        />
      )}
      {reading && (
        <CitationReader citation={reading} onClose={() => setReading(null)} />
      )}
    </span>
  );
};

/** One cited document in the field's evidence list. */
export const CitationCard = ({
  citation,
  canEdit,
  onRead,
  onEdit,
}: {
  citation: MemberFieldCitation;
  canEdit: boolean;
  onRead: () => void;
  onEdit: () => void;
}) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.evidence" });
  const documents = useDocumentStore((s) => s.documents);
  const addCitation = useCitationStore((s) => s.addCitation);
  const removeCitation = useCitationStore((s) => s.removeCitation);
  const document = documents.find((d) => d.id === citation.documentId);
  const file = document?.files.find((f) => f.id === citation.fileId) ?? null;
  const readable = file?.kind === "file";

  const where = [
    file
      ? file.filename || t("untitled-file")
      : citation.fileId
        ? null
        : t("whole-document"),
    citation.page ? t("page", { page: citation.page }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const remove = async () => {
    try {
      await removeCitation(citation.id);
      toast.success(t("removed"), {
        action: {
          label: t("undo"),
          onClick: () =>
            void addCitation({
              memberId: citation.memberId,
              field: citation.field,
              documentId: citation.documentId,
              fileId: citation.fileId,
              page: citation.page,
              quote: citation.quote,
              quotePrefix: citation.quotePrefix,
              quoteSuffix: citation.quoteSuffix,
              note: citation.note,
            }).catch(() => toast.error(t("error-save"))),
        },
      });
    } catch {
      toast.error(t("error-remove"));
    }
  };

  return (
    <li className="rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-start gap-2">
        <FileText
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">
            {document?.title ?? t("unknown-document")}
          </p>
          {where && (
            <p className="truncate text-xs text-muted-foreground">{where}</p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("edit")}
              title={t("edit")}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("remove")}
              title={t("remove")}
              className="hover:text-destructive"
              onClick={() => void remove()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {citation.quote && (
        <blockquote className="mt-2 rounded-md bg-card px-2 py-1.5 text-[13px] leading-relaxed">
          {citation.quotePrefix && (
            <span className="text-muted-foreground">
              …{lastWords(citation.quotePrefix)}{" "}
            </span>
          )}
          <mark className="rounded-sm bg-warning-soft px-0.5 text-foreground">
            {citation.quote}
          </mark>
          {citation.quoteSuffix && (
            <span className="text-muted-foreground">
              {" "}
              {firstWords(citation.quoteSuffix)}…
            </span>
          )}
        </blockquote>
      )}
      {citation.quoteFound === false && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {t("quote-not-found")}
        </p>
      )}
      {citation.note && (
        <p className="mt-1.5 text-xs whitespace-pre-line text-muted-foreground">
          {citation.note}
        </p>
      )}
      {readable && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-1 h-auto px-0 py-0 text-xs"
          onClick={onRead}
        >
          {t("open-reader")}
        </Button>
      )}
    </li>
  );
};

/** A few words of the saved context next to the quote. */
function lastWords(text: string, count = 4): string {
  return text.trim().split(/\s+/).slice(-count).join(" ");
}

function firstWords(text: string, count = 4): string {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}
