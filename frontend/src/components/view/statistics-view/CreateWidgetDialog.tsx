import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useMemberStore } from "@/hooks/useMemberStore";
import { useStatisticsSettings } from "@/hooks/useStatisticsSettings";
import {
  DIMENSION_REGISTRY,
  MEASURE_REGISTRY,
  DEFAULT_WIDGET_COLOR,
  CHART_TYPES,
  aggregate,
  type CustomChartType,
  type CustomWidget,
  type CustomWidgetConfig,
  type DimensionId,
  type MeasureId,
} from "./customWidgets";
import { CustomWidgetRenderer } from "./CustomWidgetRenderer";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: CustomWidget;
}

const NONE = "__none__";

export function CreateWidgetDialog({ open, onClose, editing }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { addCustomWidget, updateCustomWidget } = useStatisticsSettings();
  const members = useMemberStore((s) => s.members);

  const [title, setTitle] = useState("");
  const [chartType, setChartType] = useState<CustomChartType>("bar");
  const [dimensionId, setDimensionId] = useState<DimensionId>("birth-decade");
  const [measureId, setMeasureId] = useState<MeasureId>("count");
  const [breakdownId, setBreakdownId] = useState<string>(NONE);
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_WIDGET_COLOR);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setChartType(editing?.chartType ?? "bar");
    setDimensionId(editing?.dimensionId ?? "birth-decade");
    setMeasureId(editing?.measureId ?? "count");
    setBreakdownId(editing?.breakdownId ?? NONE);
    setXLabel(editing?.xLabel ?? "");
    setYLabel(editing?.yLabel ?? "");
    setColor(editing?.color ?? DEFAULT_WIDGET_COLOR);
  }, [open, editing]);

  const isPie = chartType === "pie";
  const isValid = title.trim().length > 0;

  // Suggest a title from the current selection when the user hasn't typed one.
  const suggestedTitle = `${t(
    MEASURE_REGISTRY.find((m) => m.id === measureId)!.labelKey,
  )} · ${t(DIMENSION_REGISTRY.find((d) => d.id === dimensionId)!.labelKey)}`;

  const config: CustomWidgetConfig = {
    chartType,
    dimensionId,
    measureId,
    breakdownId: isPie || breakdownId === NONE ? null : (breakdownId as DimensionId),
    title: title.trim() || suggestedTitle,
    xLabel: xLabel.trim() || undefined,
    yLabel: yLabel.trim() || undefined,
    color,
  };

  // Live preview using the real tree members.
  const previewWidget: CustomWidget = { ...config, id: "preview", kind: "custom" };
  const hasPreviewData = aggregate(members, config, t).data.length > 0;

  const handleSave = () => {
    // Title falls back to the suggested label so a widget is never untitled.
    const final: CustomWidgetConfig = isValid
      ? config
      : { ...config, title: suggestedTitle };
    if (editing) {
      updateCustomWidget(editing.id, final);
    } else {
      addCustomWidget(final);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("custom-dialog-title-edit") : t("custom-dialog-title-create")}
          </DialogTitle>
          <DialogDescription>{t("custom-dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Chart type */}
          <div className="space-y-1.5">
            <Label>{t("field-chart-type")}</Label>
            <Select value={chartType} onValueChange={(v) => setChartType(v as CustomChartType)}>
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

          {/* X axis: group by */}
          <div className="space-y-1.5">
            <Label>{t("field-group-by")}</Label>
            <Select value={dimensionId} onValueChange={(v) => setDimensionId(v as DimensionId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIMENSION_REGISTRY.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {t(d.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("field-group-by-hint")}</p>
          </div>

          {/* Y axis: measure */}
          <div className="space-y-1.5">
            <Label>{t("field-measure")}</Label>
            <Select value={measureId} onValueChange={(v) => setMeasureId(v as MeasureId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEASURE_REGISTRY.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {t(m.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("field-measure-hint")}</p>
          </div>

          {/* Optional breakdown — not available for pie charts */}
          {!isPie && (
            <div className="space-y-1.5">
              <Label>{t("field-breakdown")}</Label>
              <Select value={breakdownId} onValueChange={setBreakdownId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("breakdown-none")}</SelectItem>
                  {DIMENSION_REGISTRY.filter((d) => d.id !== dimensionId).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {t(d.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("field-breakdown-hint")}</p>
            </div>
          )}

          {/* Title + color */}
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="widget-title">{t("field-widget-title")}</Label>
              <Input
                id="widget-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={suggestedTitle}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="widget-color">{t("field-color")}</Label>
              <input
                id="widget-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
              />
            </div>
          </div>

          {/* Axis label overrides (hidden for pie) */}
          {!isPie && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="widget-xlabel">{t("field-x-label")}</Label>
                <Input
                  id="widget-xlabel"
                  value={xLabel}
                  onChange={(e) => setXLabel(e.target.value)}
                  placeholder={t(DIMENSION_REGISTRY.find((d) => d.id === dimensionId)!.labelKey)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="widget-ylabel">{t("field-y-label")}</Label>
                <Input
                  id="widget-ylabel"
                  value={yLabel}
                  onChange={(e) => setYLabel(e.target.value)}
                  placeholder={t(MEASURE_REGISTRY.find((m) => m.id === measureId)!.labelKey)}
                />
              </div>
            </div>
          )}

          {/* Live preview */}
          <div className="space-y-1.5">
            <Label>{t("custom-preview")}</Label>
            {hasPreviewData ? (
              <div className="rounded-md border border-border p-2">
                <CustomWidgetRenderer
                  widget={{ ...previewWidget, title: title.trim() || suggestedTitle }}
                  members={members}
                  t={t}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-4 text-center">
                {t("custom-preview-empty")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("custom-cancel")}
          </Button>
          <Button onClick={handleSave}>{t("custom-save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
