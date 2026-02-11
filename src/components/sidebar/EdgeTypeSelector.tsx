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
  const { edgeType, setEdgeType } = useFamilyTreeSettings();
  const { t } = useTranslation();

  return (
    <SettingsField label={t("sidebar.edgeType")}>
      <Select
        value={edgeType}
        onValueChange={(val) => setEdgeType(val as EdgeType)}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder="Select type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectItem value="straight">Straight</SelectItem>
          <SelectItem value="step">Step</SelectItem>
          <SelectItem value="smoothstep">Smoothstep</SelectItem>
        </SelectContent>
      </Select>
    </SettingsField>
  );
};
