import { useTranslation } from "react-i18next";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccessLevel, AccessLevels, SHARE_AREAS } from "@/types/workspace";
import { ACCESS_PRESETS, PRESET_ORDER, presetOf } from "@/utils/accessLevels";
import { cn } from "@/lib/utils";

type Props = {
  levels: AccessLevels;
  onChange: (levels: AccessLevels) => void;
  disabled?: boolean;
};

const LEVELS: AccessLevel[] = ["hidden", "view", "edit"];

/** Pick a share's level per area (#1101): a preset, or a custom grid. */
export const AccessLevelsPicker = ({ levels, onChange, disabled }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.share-tree.access",
  });
  const preset = presetOf(levels);
  const label = preset ? t(`presets.${preset}`) : t("presets.custom");

  if (disabled) {
    return <span className="text-sm text-muted-foreground">{label}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-36 justify-between font-normal"
          aria-label={t("button", { preset: label })}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t("presets-title")}
        </p>
        <div className="mb-3 grid grid-cols-2 gap-1">
          {PRESET_ORDER.map((p) => (
            <Button
              key={p}
              variant={p === preset ? "secondary" : "ghost"}
              size="sm"
              className={cn("justify-start", p === preset && "font-medium")}
              aria-pressed={p === preset}
              onClick={() => onChange(ACCESS_PRESETS[p])}
            >
              {t(`presets.${p}`)}
            </Button>
          ))}
        </div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t("areas-title")}
        </p>
        <div className="space-y-1">
          {SHARE_AREAS.map((area) => (
            <div key={area} className="flex items-center justify-between gap-2">
              <span className="text-sm">{t(`areas.${area}`)}</span>
              <Select
                value={levels[area]}
                onValueChange={(v) =>
                  onChange({ ...levels, [area]: v as AccessLevel })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-28"
                  aria-label={t(`areas.${area}`)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.filter(
                    (level) => area !== "tree" || level !== "hidden",
                  ).map((level) => (
                    <SelectItem key={level} value={level}>
                      {t(`levels.${level}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
