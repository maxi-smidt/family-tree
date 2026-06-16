import { Member } from "@/types/member";
import { useSourceStore } from "@/hooks/useSourceStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { BookMarked, Plus, Pencil, Trash2, File, Link } from "lucide-react";
import { useState } from "react";
import { SourceCitationDialog } from "./SourceCitationDialog";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { useTranslation } from "react-i18next";
import { Citation } from "@/types/source";

type Props = {
  member: Member;
};

export const MemberSources = ({ member }: Props) => {
  const { t, i18n } = useTranslation();
  const tS = (k: string) => t(`sheet.member-sheet.sources.${k}`);
  const { getCitationsByMember, getSourcesForMember, removeCitation } =
    useSourceStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCitation, setEditingCitation] = useState<Citation | null>(null);
  const [citationToDelete, setCitationToDelete] = useState<Citation | null>(
    null,
  );

  const citations = getCitationsByMember(member.id);
  const sourcesForMember = getSourcesForMember(member.id);

  const handleAdd = () => {
    setEditingCitation(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (cit: Citation) => {
    setEditingCitation(cit);
    setIsDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (citationToDelete) {
      await removeCitation(citationToDelete.id);
      setCitationToDelete(null);
    }
  };

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{tS("title")}</ItemTitle>
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {tS("add")}
          </Button>
        </div>

        {citations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {tS("no-citations")}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {citations.map((cit) => {
              const source = sourcesForMember.find((s) => s.id === cit.sourceId);
              return (
                <div
                  key={cit.id}
                  className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <BookMarked className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {source?.title ?? cit.sourceId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {i18n.t(
                            `sheet.member-sheet.sources.fact.${cit.factType}`,
                          )}
                          {cit.page && ` · ${cit.page}`}
                        </p>
                        {cit.detail && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {cit.detail}
                          </p>
                        )}
                        {source && source.evidence.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {source.evidence.slice(0, 3).map((ev) => (
                              <span
                                key={ev.id}
                                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                              >
                                {ev.kind === "file" ? (
                                  <File className="w-2.5 h-2.5" />
                                ) : (
                                  <Link className="w-2.5 h-2.5" />
                                )}
                                <span className="truncate max-w-24">
                                  {ev.filename ?? ev.url}
                                </span>
                              </span>
                            ))}
                            {source.evidence.length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{source.evidence.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => handleEdit(cit)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => setCitationToDelete(cit)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ItemContent>

      <SourceCitationDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        memberId={member.id}
        citation={editingCitation}
      />

      <ConfirmDeleteDialog
        open={!!citationToDelete}
        onOpenChange={(open) => !open && setCitationToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title={tS("delete-dialog.title")}
        description={tS("delete-dialog.description")}
        cancelText={tS("delete-dialog.cancel")}
        confirmText={tS("delete-dialog.delete")}
      />
    </Item>
  );
};
