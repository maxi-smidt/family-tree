import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  ImageDown,
  Lock,
  LockOpen,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Route,
  Undo2,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeExport } from "@/hooks/useTreeExport";

type Props = {
  navigationOnly?: boolean;
  isConnectionMode?: boolean;
  connectionDisabled?: boolean;
  onToggleConnectionMode?: () => void;
};

export const FlowPanelControls = ({
  navigationOnly = false,
  isConnectionMode = false,
  connectionDisabled = false,
  onToggleConnectionMode,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { isLockedScreen, setIsLockedScreen } = useFamilyTreeSettings();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const undo = useMemberStore((s) => s.undo);
  const redo = useMemberStore((s) => s.redo);
  const undoStack = useMemberStore((s) => s.undoStack);
  const redoStack = useMemberStore((s) => s.redoStack);
  const { exportImage, isExporting } = useTreeExport();

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
                aria-label={t("undo")}
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
                aria-label={t("redo")}
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
          <Button
            variant="secondary"
            size="icon"
            onClick={() => zoomIn()}
            aria-label={t("zoom-in")}
          >
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("zoom-in")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => zoomOut()}
            aria-label={t("zoom-out")}
          >
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("zoom-out")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => fitView()}
            aria-label={t("fit-view")}
          >
            <Maximize />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("fit-view")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isConnectionMode ? "default" : "secondary"}
            size="icon"
            onClick={onToggleConnectionMode}
            disabled={connectionDisabled || !onToggleConnectionMode}
            aria-label={
              isConnectionMode
                ? t("disable-connection-mode")
                : t("enable-connection-mode")
            }
          >
            <Route />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {isConnectionMode
            ? t("disable-connection-mode")
            : t("enable-connection-mode")}
        </TooltipContent>
      </Tooltip>
      {!navigationOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isLockedScreen ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsLockedScreen(!isLockedScreen)}
              aria-label={
                isLockedScreen ? t("unlock-canvas") : t("lock-canvas")
              }
            >
              {isLockedScreen ? <Lock /> : <LockOpen />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isLockedScreen ? t("unlock-canvas") : t("lock-canvas")}
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => void exportImage()}
            disabled={isExporting}
            aria-label={t("export-image")}
          >
            {isExporting ? <Loader2 className="animate-spin" /> : <ImageDown />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("export-image")}</TooltipContent>
      </Tooltip>
    </ButtonGroup>
  );
};
