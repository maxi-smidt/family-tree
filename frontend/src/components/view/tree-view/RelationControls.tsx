import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Settings2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { PARENT_RELATION_TYPE } from "@/types/member";
import { resolveRelationLabel } from "@/utils/relationLabelUtils";

export const RelationControls = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { t: tRelation } = useTranslation(undefined, {
    keyPrefix: "common.relation-types",
  });
  const { visibleRelationTypes, toggleRelationType } = useFamilyTreeSettings();
  const { relationTypes } = useTreeStore();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon">
              <Settings2 className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{t("select-relation")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-56"
        side="left"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel>{t("select-relation")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {relationTypes.map((type) => (
          <DropdownMenuCheckboxItem
            key={type.id}
            checked={visibleRelationTypes.includes(type.id)}
            onCheckedChange={() => {
              toggleRelationType(type.id);
            }}
            onSelect={(e) => e.preventDefault()}
            disabled={type.id === PARENT_RELATION_TYPE}
          >
            {resolveRelationLabel(type, tRelation)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
