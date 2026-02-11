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
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { Settings2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const RelationControls = () => {
  const { visibleRelationTypes, toggleRelationType } = useFamilyTreeSettings();
  const { relationTypes } = useFamilyStore();

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
        <TooltipContent side="left">Visible Relations</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-56"
        side="left"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel>Visible Relations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {relationTypes.map((type) => (
          <DropdownMenuCheckboxItem
            key={type.id}
            checked={visibleRelationTypes.includes(type.id)}
            onCheckedChange={() => {
              toggleRelationType(type.id);
            }}
            onSelect={(e) => e.preventDefault()}
            disabled={type.id === "parent"}
          >
            {type.description}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
