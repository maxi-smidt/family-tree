import { useState } from "react";
import { SlidersHorizontal, ChevronUp, ChevronDown, Plus, Pencil, Trash2 } from "lucide-react";
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
import { CreateWidgetDialog } from "./CreateWidgetDialog";
import type { CustomWidget } from "./customWidgets";

export function CustomizePopover() {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { order, hidden, customWidgets, toggleWidget, moveWidget, removeCustomWidget, reset } =
    useStatisticsSettings();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<CustomWidget | undefined>(undefined);

  const customById = Object.fromEntries(customWidgets.map((w) => [w.id, w]));
  const customIds = customWidgets.map((w) => w.id);
  const normalizedOrder = normalizeOrder(order, customIds);

  const openCreate = () => {
    setEditingWidget(undefined);
    setDialogOpen(true);
  };

  const openEdit = (widget: CustomWidget) => {
    setEditingWidget(widget);
    setDialogOpen(true);
  };

  return (
    <>
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
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={reset}
              >
                {t("customize-reset")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={openCreate}
                aria-label={t("create-widget")}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <Separator className="mb-2" />
          <div className="space-y-1">
            {normalizedOrder.map((id, index) => {
              const isVisible = !hidden.includes(id);
              const isFirst = index === 0;
              const isLast = index === normalizedOrder.length - 1;
              const isCustom = id in customById;
              const customWidget = isCustom ? customById[id] : undefined;
              const label = isCustom
                ? customWidget!.title
                : t(WIDGET_MAP[id as keyof typeof WIDGET_MAP]?.titleKey ?? id);

              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                >
                  <Switch
                    id={`widget-switch-${id}`}
                    checked={isVisible}
                    onCheckedChange={() => toggleWidget(id)}
                    aria-label={label}
                  />
                  <label
                    htmlFor={`widget-switch-${id}`}
                    className="flex-1 text-xs cursor-pointer truncate"
                  >
                    {label}
                  </label>
                  <div className="flex gap-0.5 shrink-0">
                    {isCustom && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(customWidget!)}
                          aria-label={t("edit-widget")}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => removeCustomWidget(id)}
                          aria-label={t("delete-widget")}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </>
                    )}
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

      <CreateWidgetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editingWidget}
      />
    </>
  );
}
