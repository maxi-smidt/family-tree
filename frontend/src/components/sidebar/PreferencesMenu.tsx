import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThemeSelector } from "@/components/sidebar/ThemeSelector";
import { LanguageSelector } from "@/components/sidebar/LanguageSelector";
import { EdgeTypeSelector } from "@/components/sidebar/EdgeTypeSelector";
import { GenerationLineSpacingSelector } from "@/components/sidebar/GenerationLineSpacingSelector";

/**
 * Display preferences (theme, language, tree edge style, generation-line
 * spacing). They used to fill the top of the sidebar; they're set rarely, so
 * they now live behind one button next to the account menu.
 */
export const PreferencesMenu = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "sidebar.preferences" });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("open")}
          title={t("open")}
          className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground"
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-2">
        <div className="px-2 pt-1 pb-0.5 text-sm font-semibold">
          {t("title")}
        </div>
        <ThemeSelector />
        <LanguageSelector />
        <EdgeTypeSelector />
        <GenerationLineSpacingSelector />
      </PopoverContent>
    </Popover>
  );
};
