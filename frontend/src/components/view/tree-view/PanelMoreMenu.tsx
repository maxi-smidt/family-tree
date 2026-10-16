import { ReactNode } from "react";
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
import { ToolbarButton } from "@/components/view/tree-view/CanvasToolbar";

type Props = {
  label: string;
  side: "top" | "bottom" | "left" | "right";
  children: ReactNode;
};

/**
 * Overflow ("more actions") trigger for a canvas control stack: an icon
 * button with a tooltip that opens a dropdown menu of secondary actions.
 * The canvas toolbar shows exactly one: MemberControls' when editing (it
 * also carries the canvas-wide items), FlowPanelControls' otherwise.
 */
export const PanelMoreMenu = ({ label, side, children }: Props) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <ToolbarButton aria-label={label}>
            <MoreHorizontal />
          </ToolbarButton>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
    <DropdownMenuContent side={side} align="end">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);
