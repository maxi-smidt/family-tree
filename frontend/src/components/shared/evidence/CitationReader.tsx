import { useDocumentStore } from "@/hooks/useDocumentStore";
import { MemberFieldCitation } from "@/types/citation";
import { DocumentFileTextDialog } from "@/components/shared/member-sheet/DocumentFileTextDialog";

/** The file reader opened on one citation: its page shown and its quote
 *  marked. */
export const CitationReader = ({
  citation,
  onClose,
}: {
  citation: MemberFieldCitation;
  onClose: () => void;
}) => {
  const file = useDocumentStore((s) =>
    s.documents
      .find((d) => d.id === citation.documentId)
      ?.files.find((f) => f.id === citation.fileId),
  );
  if (!file) return null;
  return (
    <DocumentFileTextDialog
      documentId={citation.documentId}
      file={file}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      focusCitationId={citation.id}
    />
  );
};
