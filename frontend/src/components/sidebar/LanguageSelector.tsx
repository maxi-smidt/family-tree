import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/sidebar/SettingsField";

export function LanguageSelector() {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sidebar.language-selector",
  });

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value).then();
  };

  return (
    <SettingsField label={t("select")}>
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder={t("select")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">{i18n.t("common.english")}</SelectItem>
          <SelectItem value="de">{i18n.t("common.german")}</SelectItem>
        </SelectContent>
      </Select>
    </SettingsField>
  );
}
