import { SettingsField } from "@/components/sidebar/SettingsField";
import { EdgeType, useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export const EdgeTypeSelector = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "sidebar" });
  const { edgeType, setEdgeType } = useFamilyTreeSettings();

  return (
    <SettingsField label={t("edge-type")}>
      <Select
        value={edgeType}
        onValueChange={(val) => setEdgeType(val as EdgeType)}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder={t("edge-type-placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("step-type.default")}</SelectItem>
          <SelectItem value="straight">{t("step-type.straight")}</SelectItem>
          <SelectItem value="step">{t("step-type.step")}</SelectItem>
          <SelectItem value="smoothstep">
            {t("step-type.smoothstep")}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsField>
  );
};
