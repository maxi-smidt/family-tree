import { Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export interface ListFilterState {
  gender: "all" | "m" | "f" | "o";
  status: "all" | "alive" | "deceased";
  hasPhoto: boolean;
}

export const DEFAULT_FILTERS: ListFilterState = {
  gender: "all",
  status: "all",
  hasPhoto: false,
};

function countActiveFilters(filters: ListFilterState): number {
  let count = 0;
  if (filters.gender !== "all") count++;
  if (filters.status !== "all") count++;
  if (filters.hasPhoto) count++;
  return count;
}

interface Props {
  filters: ListFilterState;
  onChange: (filters: ListFilterState) => void;
}

export function ListFilters({ filters, onChange }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: "list-view.view" });
  const activeCount = countActiveFilters(filters);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Filter className="w-3.5 h-3.5" />
          {t("filters")}
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t("filter-gender")}
            </p>
            <ToggleGroup
              type="single"
              value={filters.gender}
              onValueChange={(v) =>
                v &&
                onChange({ ...filters, gender: v as ListFilterState["gender"] })
              }
              className="flex-wrap justify-start gap-1"
            >
              <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
                {t("filter-all")}
              </ToggleGroupItem>
              <ToggleGroupItem value="m" className="h-7 px-2 text-xs">
                {t("filter-male")}
              </ToggleGroupItem>
              <ToggleGroupItem value="f" className="h-7 px-2 text-xs">
                {t("filter-female")}
              </ToggleGroupItem>
              <ToggleGroupItem value="o" className="h-7 px-2 text-xs">
                {t("filter-other")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Separator />
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t("filter-status")}
            </p>
            <ToggleGroup
              type="single"
              value={filters.status}
              onValueChange={(v) =>
                v &&
                onChange({
                  ...filters,
                  status: v as ListFilterState["status"],
                })
              }
              className="flex-wrap justify-start gap-1"
            >
              <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
                {t("filter-all")}
              </ToggleGroupItem>
              <ToggleGroupItem value="alive" className="h-7 px-2 text-xs">
                {t("status.alive")}
              </ToggleGroupItem>
              <ToggleGroupItem value="deceased" className="h-7 px-2 text-xs">
                {t("status.deceased")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {t("filter-has-photo")}
            </p>
            <Switch
              checked={filters.hasPhoto}
              onCheckedChange={(v) => onChange({ ...filters, hasPhoto: v })}
            />
          </div>
          {activeCount > 0 && (
            <>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground"
                onClick={() => onChange(DEFAULT_FILTERS)}
              >
                {t("filter-reset")}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
