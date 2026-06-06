import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";
import { useTheme } from "next-themes";

export function ThemeSelector() {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sidebar.theme-selector",
  });
  const { theme, setTheme } = useTheme();

  return (
    <SettingsField label={t("label")}>
      <Select value={theme} onValueChange={setTheme}>
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">{t("light")}</SelectItem>
          <SelectItem value="dark">{t("dark")}</SelectItem>
          <SelectItem value="system">{t("system")}</SelectItem>
        </SelectContent>
      </Select>
    </SettingsField>
  );
}
