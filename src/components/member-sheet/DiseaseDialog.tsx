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
import { Disease, CarrierStatus } from "@/types/disease";
import { useTranslation } from "react-i18next";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DiseaseDialogProps {
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
}: DiseaseDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.diseases.dialog",
  });
  const { addDisease, updateDisease } = useMemberStore();

  const [name, setName] = useState("");
  const [carrierStatus, setCarrierStatus] = useState<CarrierStatus>("unknown");
  const [diagnosisDate, setDiagnosisDate] = useState<Date | undefined>(
    undefined
  );
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (disease) {
      setName(disease.name);
      setCarrierStatus(disease.carrierStatus);
      setDiagnosisDate(
        disease.diagnosisDate ? new Date(disease.diagnosisDate) : undefined
      );
      setNotes(disease.notes || "");
    } else {
      setName("");
      setCarrierStatus("unknown");
      setDiagnosisDate(undefined);
      setNotes("");
    }
  }, [disease, open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    let dateString = null;
    if (diagnosisDate) {
      const offsetMs = diagnosisDate.getTimezoneOffset() * 60 * 1000;
      const localISODate = new Date(diagnosisDate.getTime() - offsetMs);
      dateString = localISODate.toISOString().split("T")[0];
    }

    if (disease) {
      await updateDisease(
        disease.id,
        name,
        carrierStatus,
        dateString,
        notes || null
      );
    } else {
      await addDisease(memberId, name, carrierStatus, dateString, notes || null);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {disease ? t("title-edit") : t("title-add")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
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
            <Button type="submit">{disease ? t("update") : t("add")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
