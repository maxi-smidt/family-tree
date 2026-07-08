import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { DocumentDialog } from "./DocumentDialog";

interface Props {
  /** Currently linked document ids. */
  documentIds: string[];
  /** Called with the new full set of linked document ids. */
  onChange: (ids: string[]) => void;
  /** Members to pre-select when creating a document inline. */
  seedMemberIds: string[];
}

/** "Linked documents" multi-select plus an inline "Create document" action.
 *  Shared by the Story and Event dialogs. */
export const DocumentLinkField = ({
  documentIds,
  onChange,
  seedMemberIds,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.linked",
  });
  const { documents, initialized, refreshDocuments } = useDocumentStore();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!initialized) void refreshDocuments();
  }, [initialized, refreshDocuments]);

  const options = documents.map((d) => ({ label: d.title, value: d.id }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("label")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          {t("create")}
        </Button>
      </div>
      <MultiSelect
        options={options}
        onValueChange={onChange}
        defaultValue={documentIds}
        placeholder={t("placeholder")}
        emptyIndicator={t("empty")}
        variant="inverted"
        maxCount={5}
      />

      <DocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialMemberIds={seedMemberIds}
        onCreated={(id) => onChange([...documentIds, id])}
      />
    </div>
  );
};
