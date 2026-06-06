import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Lock, LockOpen, Maximize, Minus, Plus } from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";

export const FlowPanelControls = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { isLockedScreen, setIsLockedScreen } = useFamilyTreeSettings();
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  return (
    <ButtonGroup orientation="vertical">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" onClick={() => zoomIn()}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("zoom-in")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" onClick={() => zoomOut()}>
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("zoom-out")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" onClick={() => fitView()}>
            <Maximize />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("fit-view")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isLockedScreen ? "destructive" : "secondary"}
            size="icon"
            onClick={() => setIsLockedScreen(!isLockedScreen)}
          >
            {isLockedScreen ? <Lock /> : <LockOpen />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {t("toggle-interactivity")}
        </TooltipContent>
      </Tooltip>
    </ButtonGroup>
  );
};
