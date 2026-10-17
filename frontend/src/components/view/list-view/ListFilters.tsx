import { ListFilter } from "lucide-react";
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

/** Filters set in the popover (status lives in the toolbar chips). */
function countActiveFilters(filters: ListFilterState): number {
  let count = 0;
  if (filters.gender !== "all") count++;
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
        <Button variant="outline" size="sm">
          <ListFilter />
          {t("filters")}
          {activeCount > 0 && (
            <Badge className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
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
              size="sm"
              className="flex-wrap justify-start gap-1"
            >
              <ToggleGroupItem value="all" className="px-2">
                {t("filter-all")}
              </ToggleGroupItem>
              <ToggleGroupItem value="m" className="px-2">
                {t("filter-male")}
              </ToggleGroupItem>
              <ToggleGroupItem value="f" className="px-2">
                {t("filter-female")}
              </ToggleGroupItem>
              <ToggleGroupItem value="o" className="px-2">
                {t("filter-other")}
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
                className="w-full text-muted-foreground"
                onClick={() =>
                  onChange({ ...DEFAULT_FILTERS, status: filters.status })
                }
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
