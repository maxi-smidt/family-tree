import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { useStatisticsSettings } from "@/hooks/useStatisticsSettings";
import {
  DATA_SERIES_REGISTRY,
  DEFAULT_WIDGET_COLOR,
  type CustomChartType,
  type CustomWidget,
  type CustomWidgetConfig,
  type DataSeriesId,
} from "./customWidgets";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: CustomWidget;
}

const CHART_TYPES: CustomChartType[] = ["bar", "pie", "line", "area"];

export function CreateWidgetDialog({ open, onClose, editing }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { addCustomWidget, updateCustomWidget } = useStatisticsSettings();

  const [title, setTitle] = useState("");
  const [chartType, setChartType] = useState<CustomChartType>("bar");
  const [series, setSeries] = useState<DataSeriesId[]>([]);
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_WIDGET_COLOR);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setChartType(editing?.chartType ?? "bar");
      setSeries(editing?.series ?? []);
      setXLabel(editing?.xLabel ?? "");
      setYLabel(editing?.yLabel ?? "");
      setColor(editing?.color ?? DEFAULT_WIDGET_COLOR);
    }
  }, [open, editing]);

  // Determine which series are compatible with the first selected one.
  const firstSeries = series[0] ? DATA_SERIES_REGISTRY.find((d) => d.id === series[0]) : null;
  const seriesOptions = DATA_SERIES_REGISTRY.filter(
    (d) => !firstSeries || d.domain === firstSeries.domain,
  ).map((d) => ({
    label: t(d.labelKey),
    value: d.id,
  }));

  const handleSeriesChange = (values: string[]) => {
    const newSeries = values as DataSeriesId[];
    // If the first item changes to a different domain, clear incompatible selections.
    const first = DATA_SERIES_REGISTRY.find((d) => d.id === newSeries[0]);
    const filtered = first
      ? newSeries.filter((id) => {
          const def = DATA_SERIES_REGISTRY.find((d) => d.id === id);
          return def?.domain === first.domain;
        })
      : newSeries;
    setSeries(filtered);
  };

  const isValid = title.trim().length > 0 && series.length > 0;
  const isPie = chartType === "pie";

  const handleSave = () => {
    if (!isValid) return;
    const config: CustomWidgetConfig = {
      chartType,
      series,
      title: title.trim(),
      xLabel: xLabel.trim() || undefined,
      yLabel: yLabel.trim() || undefined,
      color,
    };
    if (editing) {
      updateCustomWidget(editing.id, config);
    } else {
      addCustomWidget(config);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("custom-dialog-title-edit") : t("custom-dialog-title-create")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="widget-title">{t("field-widget-title")}</Label>
            <Input
              id="widget-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("field-widget-title")}
            />
          </div>

          {/* Chart type */}
          <div className="space-y-1.5">
            <Label>{t("field-chart-type")}</Label>
            <Select
              value={chartType}
              onValueChange={(v) => setChartType(v as CustomChartType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {t(`chart-type-${ct}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Data series */}
          <div className="space-y-1.5">
            <Label>{t("field-data-series")}</Label>
            <MultiSelect
              options={seriesOptions}
              defaultValue={series}
              onValueChange={handleSeriesChange}
              placeholder={t("field-data-series")}
              maxCount={3}
            />
            {isPie && series.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {t("custom-pie-single-series-note")}
              </p>
            )}
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label htmlFor="widget-color">{t("field-color")}</Label>
            <div className="flex items-center gap-2">
              <input
                id="widget-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <span className="text-xs text-muted-foreground font-mono">{color}</span>
            </div>
          </div>

          {/* Axis labels (hidden for pie) */}
          {!isPie && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="widget-xlabel">{t("field-x-label")}</Label>
                <Input
                  id="widget-xlabel"
                  value={xLabel}
                  onChange={(e) => setXLabel(e.target.value)}
                  placeholder={t("field-x-label-placeholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="widget-ylabel">{t("field-y-label")}</Label>
                <Input
                  id="widget-ylabel"
                  value={yLabel}
                  onChange={(e) => setYLabel(e.target.value)}
                  placeholder={t("field-y-label-placeholder")}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("custom-cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {t("custom-save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
