import { useState, useEffect, FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMemberStore } from "@/hooks/useMemberStore";
import { Disease, CarrierStatus, InheritancePattern } from "@/types/disease";
import { useTranslation } from "react-i18next";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disease?: Disease;
  memberId: string;
}

export const DiseaseDialog = ({
  open,
  onOpenChange,
  disease,
  memberId,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.diseases.dialog",
  });
  const { addDisease, updateDisease } = useMemberStore();

  const [name, setName] = useState("");
  const [carrierStatus, setCarrierStatus] = useState<CarrierStatus>("unknown");
  const [inheritancePattern, setInheritancePattern] =
    useState<InheritancePattern>("unknown");
  const [diagnosisDate, setDiagnosisDate] = useState<Date | undefined>(
    undefined,
  );
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (disease) {
      setName(disease.name);
      setCarrierStatus(disease.carrierStatus);
      setInheritancePattern(disease.inheritancePattern);
      setDiagnosisDate(
        disease.diagnosisDate ? new Date(disease.diagnosisDate) : undefined,
      );
      setNotes(disease.notes || "");
    } else {
      setName("");
      setCarrierStatus("unknown");
      setInheritancePattern("unknown");
      setDiagnosisDate(undefined);
      setNotes("");
    }
  }, [disease, open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    let dateString = null;
    if (diagnosisDate) {
      const offsetMs = diagnosisDate.getTimezoneOffset() * 60 * 1000;
      const localISODate = new Date(diagnosisDate.getTime() - offsetMs);
      dateString = localISODate.toISOString().split("T")[0];
    }

    try {
      if (disease) {
        await updateDisease(
          disease.id,
          name,
          carrierStatus,
          inheritancePattern,
          dateString,
          notes || null,
        );
      } else {
        await addDisease(
          memberId,
          name,
          carrierStatus,
          inheritancePattern,
          dateString,
          notes || null,
        );
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Error saving disease:", error);
      toast.error(disease ? t("error-update") : t("error-add"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {disease ? t("title-edit") : t("title-add")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("name")} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("name-placeholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="carrier-status">{t("carrier-status")} *</Label>
              <Select
                value={carrierStatus}
                onValueChange={(value) =>
                  setCarrierStatus(value as CarrierStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("carrier-status-placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="affected">
                    {t("carrier-status-affected")}
                  </SelectItem>
                  <SelectItem value="carrier">
                    {t("carrier-status-carrier")}
                  </SelectItem>
                  <SelectItem value="unknown">
                    {t("carrier-status-unknown")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inheritance-pattern">
                {t("inheritance-pattern")} *
              </Label>
              <Select
                value={inheritancePattern}
                onValueChange={(value) =>
                  setInheritancePattern(value as InheritancePattern)
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("inheritance-pattern-placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="autosomal_dominant">
                    {t("inheritance-pattern-autosomal-dominant")}
                  </SelectItem>
                  <SelectItem value="autosomal_recessive">
                    {t("inheritance-pattern-autosomal-recessive")}
                  </SelectItem>
                  <SelectItem value="x_linked_dominant">
                    {t("inheritance-pattern-x-linked-dominant")}
                  </SelectItem>
                  <SelectItem value="x_linked_recessive">
                    {t("inheritance-pattern-x-linked-recessive")}
                  </SelectItem>
                  <SelectItem value="y_linked">
                    {t("inheritance-pattern-y-linked")}
                  </SelectItem>
                  <SelectItem value="mitochondrial">
                    {t("inheritance-pattern-mitochondrial")}
                  </SelectItem>
                  <SelectItem value="multifactorial">
                    {t("inheritance-pattern-multifactorial")}
                  </SelectItem>
                  <SelectItem value="unknown">
                    {t("inheritance-pattern-unknown")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis-date">{t("diagnosis-date")}</Label>
              <DatePicker
                value={diagnosisDate}
                onChange={setDiagnosisDate}
                placeholder={t("diagnosis-date-placeholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notes-placeholder")}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm">
              {disease ? t("update") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
