import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { PanelMoreMenu } from "@/components/view/tree-view/PanelMoreMenu";
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
  SquareDashedMousePointer,
  Undo2,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeExport } from "@/hooks/useTreeExport";
import { fitViewToAllNodes } from "@/utils/flowFit";

type Props = {
  navigationOnly?: boolean;
  isConnectionMode?: boolean;
  connectionDisabled?: boolean;
  onToggleConnectionMode?: () => void;
  isSelectionMode?: boolean;
  selectionAvailable?: boolean;
  onToggleSelectionMode?: () => void;
  selectionDisabled?: boolean;
};

export const FlowPanelControls = ({
  navigationOnly = false,
  isConnectionMode = false,
  connectionDisabled = false,
  onToggleConnectionMode,
  isSelectionMode = false,
  selectionAvailable = false,
  onToggleSelectionMode,
  selectionDisabled = false,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { isLockedScreen, setIsLockedScreen } = useFamilyTreeSettings();
  const reactFlow = useReactFlow();
  const undo = useMemberStore((s) => s.undo);
  const redo = useMemberStore((s) => s.redo);
  const undoStack = useMemberStore((s) => s.undoStack);
  const redoStack = useMemberStore((s) => s.redoStack);
  const { exportImage, isExporting } = useTreeExport();

  return (
    <div className="flex flex-col gap-2">
      {!navigationOnly && (
        <ButtonGroup orientation="vertical">
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
        </ButtonGroup>
      )}

      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => reactFlow.zoomIn()}
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
              onClick={() => reactFlow.zoomOut()}
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
              onClick={() => fitViewToAllNodes(reactFlow)}
              aria-label={t("fit-view")}
            >
              <Maximize />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("fit-view")}</TooltipContent>
        </Tooltip>
      </ButtonGroup>

      <ButtonGroup orientation="vertical">
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
        {selectionAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isSelectionMode ? "default" : "secondary"}
                size="icon"
                onClick={onToggleSelectionMode}
                disabled={selectionDisabled || !onToggleSelectionMode}
                aria-label={
                  isSelectionMode
                    ? t("disable-selection-mode")
                    : t("enable-selection-mode")
                }
              >
                <SquareDashedMousePointer />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isSelectionMode
                ? t("disable-selection-mode")
                : t("enable-selection-mode")}
            </TooltipContent>
          </Tooltip>
        )}
      </ButtonGroup>

      <PanelMoreMenu label={t("more-actions")} side="right">
        {!navigationOnly && (
          <DropdownMenuCheckboxItem
            checked={isLockedScreen}
            onCheckedChange={setIsLockedScreen}
            onSelect={(e) => e.preventDefault()}
          >
            {isLockedScreen ? <Lock /> : <LockOpen />}
            {isLockedScreen ? t("unlock-canvas") : t("lock-canvas")}
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuItem
          onSelect={() => void exportImage()}
          disabled={isExporting}
        >
          {isExporting ? <Loader2 className="animate-spin" /> : <ImageDown />}
          {t("export-image")}
        </DropdownMenuItem>
      </PanelMoreMenu>
    </div>
  );
};
