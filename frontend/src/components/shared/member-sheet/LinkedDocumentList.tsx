import { FileText } from "lucide-react";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { DocumentFileList } from "./DocumentFiles";

/** Read-only display of the documents linked to a story or event. Looks each
 *  id up in the document store and shows the title plus its files. */
export const LinkedDocumentList = ({
  documentIds,
}: {
  documentIds: string[];
}) => {
  const { documents } = useDocumentStore();

  const linked = documentIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);

  if (linked.length === 0) return null;

  return (
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
  );
};
