import { SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useStatisticsSettings, normalizeOrder } from "@/hooks/useStatisticsSettings";
import { WIDGET_MAP } from "./widgets";

export function CustomizePopover() {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { order, hidden, toggleWidget, moveWidget, reset } =
    useStatisticsSettings();

  const normalizedOrder = normalizeOrder(order);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {t("customize")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-sm font-medium">{t("customize-title")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={reset}
          >
            {t("customize-reset")}
          </Button>
        </div>
        <Separator className="mb-2" />
        <div className="space-y-1">
          {normalizedOrder.map((id, index) => {
            const def = WIDGET_MAP[id];
            const isVisible = !hidden.includes(id);
            const isFirst = index === 0;
            const isLast = index === normalizedOrder.length - 1;

            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
              >
                <Switch
                  id={`widget-switch-${id}`}
                  checked={isVisible}
                  onCheckedChange={() => toggleWidget(id)}
                  aria-label={t(def.titleKey)}
                />
                <label
                  htmlFor={`widget-switch-${id}`}
                  className="flex-1 text-xs cursor-pointer truncate"
                >
                  {t(def.titleKey)}
                </label>
                <div className="flex gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isFirst}
                    onClick={() => moveWidget(id, "up")}
                    aria-label={t("move-up")}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isLast}
                    onClick={() => moveWidget(id, "down")}
                    aria-label={t("move-down")}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
