import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { PanelMoreMenu } from "@/components/view/tree-view/PanelMoreMenu";
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/view/tree-view/CanvasToolbar";
import {
  ImageDown,
  Lock,
  LockOpen,
  Loader2,
  Map as MapIcon,
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
import { ShortcutHint } from "@/components/ui/shortcut-hint";
import { useTreeNavigationShortcuts } from "@/hooks/useTreeNavigationShortcuts";

type Props = {
  navigationOnly?: boolean;
  isConnectionMode?: boolean;
  connectionDisabled?: boolean;
  onToggleConnectionMode?: () => void;
  isSelectionMode?: boolean;
  selectionAvailable?: boolean;
  onToggleSelectionMode?: () => void;
  selectionDisabled?: boolean;
  /**
   * Render the overflow menu here. Off when MemberControls follows in the
   * same toolbar: it then carries these items in its own menu, so the bar
   * ends in a single "more" button.
   */
  showMoreMenu?: boolean;
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
  showMoreMenu = true,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const reactFlow = useReactFlow();
  useTreeNavigationShortcuts(reactFlow);
  const undo = useMemberStore((s) => s.undo);
  const redo = useMemberStore((s) => s.redo);
  const undoStack = useMemberStore((s) => s.undoStack);
  const redoStack = useMemberStore((s) => s.redoStack);
  const showMinimap = useFamilyTreeSettings((s) => s.showMinimap);
  const setShowMinimap = useFamilyTreeSettings((s) => s.setShowMinimap);

  return (
    <>
      {!navigationOnly && (
        <ToolbarGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={() => undo()}
                disabled={undoStack.length === 0}
                aria-label={t("undo")}
              >
                <Undo2 />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent side="top">{t("undo")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                onClick={() => redo()}
                disabled={redoStack.length === 0}
                aria-label={t("redo")}
              >
                <Redo2 />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent side="top">{t("redo")}</TooltipContent>
          </Tooltip>
        </ToolbarGroup>
      )}
      {!navigationOnly && <ToolbarSeparator />}

      <ToolbarGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={() => reactFlow.zoomIn()}
              aria-label={t("zoom-in")}
              shortcut="zoom-in"
            >
              <Plus />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t("zoom-in")} <ShortcutHint shortcut="zoom-in" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={() => reactFlow.zoomOut()}
              aria-label={t("zoom-out")}
              shortcut="zoom-out"
            >
              <Minus />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t("zoom-out")} <ShortcutHint shortcut="zoom-out" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={() => fitViewToAllNodes(reactFlow)}
              aria-label={t("fit-view")}
            >
              <Maximize />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t("fit-view")}
            <p className="mt-1 opacity-70">{t("keyboard-navigation-hint")}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              active={showMinimap}
              onClick={() => setShowMinimap(!showMinimap)}
              aria-label={showMinimap ? t("hide-minimap") : t("show-minimap")}
            >
              <MapIcon />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {showMinimap ? t("hide-minimap") : t("show-minimap")}
          </TooltipContent>
        </Tooltip>
      </ToolbarGroup>
      <ToolbarSeparator />

      <ToolbarGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              active={isConnectionMode}
              onClick={onToggleConnectionMode}
              disabled={connectionDisabled || !onToggleConnectionMode}
              aria-label={
                isConnectionMode
                  ? t("disable-connection-mode")
                  : t("enable-connection-mode")
              }
            >
              <Route />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isConnectionMode
              ? t("disable-connection-mode")
              : t("enable-connection-mode")}
          </TooltipContent>
        </Tooltip>
        {selectionAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                active={isSelectionMode}
                onClick={onToggleSelectionMode}
                disabled={selectionDisabled || !onToggleSelectionMode}
                aria-label={
                  isSelectionMode
                    ? t("disable-selection-mode")
                    : t("enable-selection-mode")
                }
              >
                <SquareDashedMousePointer />
              </ToolbarButton>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isSelectionMode
                ? t("disable-selection-mode")
                : t("enable-selection-mode")}
            </TooltipContent>
          </Tooltip>
        )}
      </ToolbarGroup>

      {showMoreMenu && (
        <>
          <ToolbarSeparator />
          <PanelMoreMenu label={t("more-actions")} side="top">
            <CanvasMenuItems navigationOnly={navigationOnly} />
          </PanelMoreMenu>
        </>
      )}
    </>
  );
};

/**
 * Canvas-wide overflow actions (lock, export). Rendered in this panel's own
 * menu, or handed to MemberControls so both sets share one menu.
 */
export const CanvasMenuItems = ({
  navigationOnly = false,
}: {
  navigationOnly?: boolean;
}) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const { isLockedScreen, setIsLockedScreen } = useFamilyTreeSettings();
  const { exportImage, isExporting } = useTreeExport();

  return (
    <>
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
        inset
        onSelect={() => void exportImage()}
        disabled={isExporting}
      >
        {isExporting ? <Loader2 className="animate-spin" /> : <ImageDown />}
        {t("export-image")}
      </DropdownMenuItem>
    </>
  );
};
