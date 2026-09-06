import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { ViewId, resolveTabs } from "@/lib/tabs";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type SortableRowProps = {
  view: ViewId;
  label: string;
  isHidden: boolean;
  isLastVisible: boolean;
  onToggle: (id: string) => void;
};

function SortableRow({
  view,
  label,
  isHidden,
  isLastVisible,
  onToggle,
}: SortableRowProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.tab-settings",
  });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: view });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label={t("drag-handle")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm">{label}</span>
      <Switch
        checked={!isHidden}
        onCheckedChange={() => onToggle(view)}
        disabled={!isHidden && isLastVisible}
        aria-label={t("toggle-visibility")}
      />
    </div>
  );
}

export const TabSettingsDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.tab-settings",
  });
  const { t: tTabs } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });

  const { order, hidden, setOrder, toggleHidden, reset } = useTabPreferences();
  const { ordered, visible } = resolveTabs(order, hidden);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const viewLabels: Record<ViewId, string> = {
    "tree-view": tTabs("tree"),
    "list-view": tTabs("list"),
    "media-view": tTabs("media"),
    "timeline-view": tTabs("timeline"),
    "map-view": tTabs("map"),
    "activity-view": tTabs("activity"),
    "quality-report-view": tTabs("quality-report"),
    "statistics-view": tTabs("statistics"),
    "database-management-view": tTabs("database-management"),
    "friends-view": tTabs("friends"),
    "migration-review-view": tTabs("migration-review"),
    "identity-links-view": tTabs("identity-links"),
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.indexOf(active.id as ViewId);
    const newIndex = ordered.indexOf(over.id as ViewId);
    setOrder(arrayMove(ordered, oldIndex, newIndex));
  }

  async function handleReset() {
    await reset();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordered}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-0.5 py-2">
              {ordered.map((view) => (
                <SortableRow
                  key={view}
                  view={view}
                  label={viewLabels[view]}
                  isHidden={hidden.includes(view)}
                  isLastVisible={visible.length === 1 && visible[0] === view}
                  onToggle={toggleHidden}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <p className="text-xs text-muted-foreground">{t("last-tab-hint")}</p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleReset}>
            {t("reset")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
