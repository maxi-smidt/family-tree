import { useState } from "react";
import { ChevronDown, ChevronUp, FileText, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { DocumentFileList } from "./DocumentFiles";

/** Read-only display of the documents linked to a story or event. Collapsed by
 *  default behind a compact indicator (paperclip + count); the user toggles it
 *  open to reveal each document's title and files. */
export const LinkedDocumentList = ({
  documentIds,
}: {
  documentIds: string[];
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.linked",
  });
  const { documents } = useDocumentStore();
  const [expanded, setExpanded] = useState(false);

  const linked = documentIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);

  if (linked.length === 0) return null;

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-muted-foreground"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={expanded ? t("hide") : t("show")}
      >
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
        <span>{t("count", { count: linked.length })}</span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        )}
      </Button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {linked.map((doc) => (
            <div key={doc.id} className="rounded-md border p-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{doc.title}</span>
              </div>
              <DocumentFileList files={doc.files} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
