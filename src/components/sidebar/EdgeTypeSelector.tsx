import { SettingField } from "@/components/sidebar/SettingsField";
import { EdgeType, useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const EdgeTypeSelector = () => {
  const { edgeType, setEdgeType } = useFamilyTreeSettings();

  return (
    <SettingField label="Connection Style">
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
    </SettingField>
  );
};
