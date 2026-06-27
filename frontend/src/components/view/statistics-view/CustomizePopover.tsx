import { useState } from "react";
import {
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Plus,
  MoreVertical,
  Pencil,
  Copy,
  Download,
  Upload,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  useStatisticsSettings,
  normalizeOrder,
} from "@/hooks/useStatisticsSettings";
import { WIDGET_MAP } from "./widgets";
import { CreateWidgetDialog } from "./CreateWidgetDialog";
import type { CustomWidget } from "./customWidgets";
import { downloadWidgets, pickWidgetsFile } from "./widgetTransfer";

export function CustomizePopover() {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const {
    order,
    hidden,
    customWidgets,
    toggleWidget,
    moveWidget,
    duplicateCustomWidget,
    importCustomWidgets,
    removeCustomWidget,
    reset,
  } = useStatisticsSettings();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<CustomWidget | undefined>(
    undefined,
  );

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

  const handleExportAll = () => {
    if (customWidgets.length === 0) {
      toast.error(t("export-empty"));
      return;
    }
    downloadWidgets(customWidgets, "statistics-widgets.json");
  };

  const handleExportOne = (widget: CustomWidget) => {
    const slug = widget.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    downloadWidgets([widget], `widget-${slug || "custom"}.json`);
  };

  const handleImport = async () => {
    try {
      const configs = await pickWidgetsFile();
      if (configs === null) return; // user cancelled
      if (configs.length === 0) {
        toast.error(t("import-empty"));
        return;
      }
      const count = importCustomWidgets(configs);
      toast.success(t("import-success", { count }));
    } catch {
      toast.error(t("import-error"));
    }
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
        <PopoverContent className="w-80 p-2" align="end">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-sm font-medium">{t("customize-title")}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={openCreate}
              >
                <Plus className="w-3.5 h-3.5" />
                {t("create-widget")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={t("more-options")}
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={handleImport}>
                    <Upload className="w-3.5 h-3.5" />
                    {t("import-widgets")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleExportAll}
                    disabled={customWidgets.length === 0}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t("export-all")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={reset}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t("customize-reset")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={t("widget-actions")}
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(customWidget!)}>
                            <Pencil className="w-3.5 h-3.5" />
                            {t("edit-widget")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => duplicateCustomWidget(id)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {t("duplicate-widget")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleExportOne(customWidget!)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {t("export-widget")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => removeCustomWidget(id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t("delete-widget")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
