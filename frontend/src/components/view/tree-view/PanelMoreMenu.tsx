import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MoreHorizontal } from "lucide-react";

type Props = {
  label: string;
  side: "left" | "right";
  children: ReactNode;
};

/**
 * Overflow ("more actions") trigger for a canvas control stack: an icon
 * button with a tooltip that opens a dropdown menu of secondary actions.
 * Shared by FlowPanelControls (bottom-left) and MemberControls
 * (bottom-right) so the two panels stay visually and behaviourally
 * consistent.
 */
export const PanelMoreMenu = ({ label, side, children }: Props) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label={label}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
    <DropdownMenuContent side={side} align="end">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);
