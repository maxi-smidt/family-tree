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
import { Switch } from "@/components/ui/switch";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { ViewId, resolveTabs } from "@/lib/tabs";

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

export function TabSettingsPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.tab-settings" });
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
    "gallery-view": tTabs("gallery"),
    "documents-view": tTabs("documents"),
    "timeline-view": tTabs("timeline"),
    "map-view": tTabs("map"),
    "activity-view": tTabs("activity"),
    "quality-report-view": tTabs("quality-report"),
    "statistics-view": tTabs("statistics"),
    "database-management-view": tTabs("database-management"),
    "friends-view": tTabs("friends"),
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.indexOf(active.id as ViewId);
    const newIndex = ordered.indexOf(over.id as ViewId);
    setOrder(arrayMove(ordered, oldIndex, newIndex));
  }

  return (
    <div className="space-y-4 max-w-md">
      <div>
        <p className="font-medium text-sm">{t("title")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("description")}
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ordered} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
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

      <Button variant="outline" size="sm" onClick={() => void reset()}>
        {t("reset")}
      </Button>
    </div>
  );
}
