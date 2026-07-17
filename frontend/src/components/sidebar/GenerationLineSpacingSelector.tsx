import { SettingsField } from "@/components/sidebar/SettingsField";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTreeStore } from "@/hooks/useTreeStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GENERATION_LINE_SPACING_OPTIONS,
  getGenerationLineGapForSpacing,
  getGenerationLineSpacing,
  type GenerationLineSpacing,
} from "@/utils/generationLineSpacing";
import { useTranslation } from "react-i18next";

export const GenerationLineSpacingSelector = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "sidebar" });
  const activeTreeId = useTreeStore((s) => s.selectedTree?.id);
  const { generationLineGaps, setGenerationLineGap } = useFamilyTreeSettings();
  const spacing = getGenerationLineSpacing(
    activeTreeId ? generationLineGaps[activeTreeId] : undefined,
  );
  const spacingLabels: Record<GenerationLineSpacing, string> = {
    none: t("generation-line-spacing-options.none"),
    xs: t("generation-line-spacing-options.xs"),
    s: t("generation-line-spacing-options.s"),
    m: t("generation-line-spacing-options.m"),
    l: t("generation-line-spacing-options.l"),
    xl: t("generation-line-spacing-options.xl"),
  };

  return (
    <SettingsField label={t("generation-line-spacing")}>
      <Select
        value={spacing}
        onValueChange={(value) => {
          if (activeTreeId) {
            setGenerationLineGap(
              activeTreeId,
              getGenerationLineGapForSpacing(value as GenerationLineSpacing),
            );
          }
        }}
        disabled={!activeTreeId}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GENERATION_LINE_SPACING_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {spacingLabels[option.value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsField>
  );
};
