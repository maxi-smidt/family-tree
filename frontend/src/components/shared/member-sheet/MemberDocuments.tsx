import { Member } from "@/types/member";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { FileText, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentDialog } from "./DocumentDialog";
import { DocumentFileList } from "./DocumentFiles";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/utils/dateUtils";
import { openMedia } from "@/hooks/useMediaUrl";
import { Document } from "@/types/document";

type Props = {
  member: Member;
};

export const MemberDocuments = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents",
  });
  const { getDocumentsForMember, removeDocument } = useDocumentStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(
    null,
  );
  const [openingId, setOpeningId] = useState<string | null>(null);

  const documents = getDocumentsForMember(member.id);

  const handleAdd = () => {
    setEditingDocument(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (doc: Document) => {
    setEditingDocument(doc);
    setIsDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (documentToDelete) {
      await removeDocument(documentToDelete.id);
      setDocumentToDelete(null);
    }
  };

  const openDocument = (doc: Document) => {
    const file = doc.files.find((f) => f.kind === "file");
    const link = doc.files.find((f) => f.kind === "link");
    if (file) {
      setOpeningId(doc.id);
      void openMedia(file.url)
        .catch(() => toast.error(t("file.error-open")))
        .finally(() => setOpeningId(null));
    } else if (link) {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{t("title")}</ItemTitle>
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("no-documents")}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="border rounded-lg p-3 hover:bg-accent/50 transition-colors select-none"
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a, input"))
                    return;
                  openDocument(doc);
                }}
                aria-busy={openingId === doc.id}
                title={t("open-hint")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    {openingId === doc.id ? (
                      <Spinner className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    ) : (
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {doc.title}
                      </p>
                      {doc.documentDate && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(doc.documentDate)}
                        </p>
                      )}
                      {doc.description && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                          {doc.description}
                        </p>
                      )}
                      <DocumentFileList files={doc.files} />
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => handleEdit(doc)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setDocumentToDelete(doc)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ItemContent>

      <DocumentDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        document={editingDocument}
        initialMemberIds={[member.id]}
      />

      <ConfirmDeleteDialog
        open={!!documentToDelete}
        onOpenChange={(open) => !open && setDocumentToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </Item>
  );
};
