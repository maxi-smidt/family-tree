import { Member } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Activity } from "lucide-react";
import { DiseaseDialog } from "./DiseaseDialog";
import { RECORD_SECTION_IDS, RecordSectionCard } from "./RecordSectionCard";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Disease } from "@/types/disease";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/dateUtils";

type Props = {
  member: Member;
};

export const MemberDiseases = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.diseases",
  });
  const { t: tRoot } = useTranslation();
  const { removeDisease } = useMemberStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDisease, setEditingDisease] = useState<Disease | undefined>(
    undefined,
  );
  const [diseaseToDelete, setDiseaseToDelete] = useState<Disease | null>(null);

  const diseases = member.diseases || [];

  const handleAdd = () => {
    setEditingDisease(undefined);
    setIsDialogOpen(true);
  };

  const handleEdit = (disease: Disease) => {
    setEditingDisease(disease);
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (disease: Disease) => {
    setDiseaseToDelete(disease);
  };

  const closeDeleteDialog = () => {
    setDiseaseToDelete(null);
  };

  const handleDelete = async () => {
    if (diseaseToDelete) {
      await removeDisease(member.id, diseaseToDelete.id);
      closeDeleteDialog();
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "affected":
        return "destructive";
      case "carrier":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <>
      <RecordSectionCard
        sectionId={RECORD_SECTION_IDS.diseases}
        title={t("title")}
        headerActions={
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        }
      >
        {diseases.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("no-diseases")}
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {diseases.map((disease) => (
              <div
                key={disease.id}
                className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{disease.name}</span>
                      <Badge
                        variant={getStatusBadgeVariant(disease.carrierStatus)}
                      >
                        {t(`dialog.carrier-status-${disease.carrierStatus}`)}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-1">
                      {disease.inheritancePattern !== "unknown" && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            `dialog.inheritance-pattern-${disease.inheritancePattern.replace(/_/g, "-")}`,
                          )}
                        </p>
                      )}
                      {disease.diagnosisDate && (
                        <p className="text-sm text-muted-foreground">
                          {formatDate(disease.diagnosisDate)}
                        </p>
                      )}
                    </div>
                    {disease.notes && (
                      <p className="text-sm mt-2">{disease.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => handleEdit(disease)}
                      aria-label={tRoot(
                        "sheet.member-sheet.diseases.dialog.title-edit",
                      )}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => openDeleteDialog(disease)}
                      aria-label={tRoot(
                        "sheet.member-sheet.diseases.delete-dialog.title",
                      )}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </RecordSectionCard>

      <DiseaseDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        disease={editingDisease}
        memberId={member.id}
      />

      <ConfirmDeleteDialog
        open={!!diseaseToDelete}
        onOpenChange={closeDeleteDialog}
        onConfirm={handleDelete}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </>
  );
};
