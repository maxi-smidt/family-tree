import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * Compact light/dark theme toggle. Flips between light and dark based on the
 * currently resolved theme (so it works even when the active theme is
 * "system"). Backed by the same next-themes provider as the sidebar selector.
 */
export const ThemeToggle = ({ className }: { className?: string }) => {
  const { t } = useTranslation(undefined, { keyPrefix: "common.theme-toggle" });
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? t("to-light") : t("to-dark");

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
};
