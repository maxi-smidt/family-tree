import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Lock,
  LockOpen,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";

type Props = {
  navigationOnly?: boolean;
};

export const FlowPanelControls = ({ navigationOnly = false }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { isLockedScreen, setIsLockedScreen } = useFamilyTreeSettings();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const undo = useMemberStore((s) => s.undo);
  const redo = useMemberStore((s) => s.redo);
  const undoStack = useMemberStore((s) => s.undoStack);
  const redoStack = useMemberStore((s) => s.redoStack);

  return (
    <ButtonGroup orientation="vertical">
      {!navigationOnly && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => undo()}
                disabled={undoStack.length === 0}
              >
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("undo")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => redo()}
                disabled={redoStack.length === 0}
              >
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("redo")}</TooltipContent>
          </Tooltip>
        </>
      )}
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
      {!navigationOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isLockedScreen ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsLockedScreen(!isLockedScreen)}
            >
              {isLockedScreen ? <Lock /> : <LockOpen />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isLockedScreen ? t("unlock-canvas") : t("lock-canvas")}
          </TooltipContent>
        </Tooltip>
      )}
    </ButtonGroup>
  );
};
