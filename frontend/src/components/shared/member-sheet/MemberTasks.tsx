import { Member } from "@/types/member";
import { useTaskStore } from "@/hooks/useTaskStore";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Plus, Pencil, Trash2 } from "lucide-react";
import { TaskDialog } from "./TaskDialog";
import { RECORD_SECTION_IDS, RecordSectionCard } from "./RecordSectionCard";
import { useTranslation } from "react-i18next";
import { useContentManager } from "@/hooks/useContentManager";
import { compareTasks } from "@/types/task";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";

type Props = {
  member: Member;
};

export const MemberTasks = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.tasks",
  });
  const { getTasksByMember, removeTask, setTaskDone } = useTaskStore();

  const {
    items: tasks,
    isDialogOpen,
    setIsDialogOpen,
    editingItem: editingTask,
    itemToDelete: taskToDelete,
    handleAdd,
    handleEdit,
    handleDelete,
    openDeleteDialog,
    closeDeleteDialog,
  } = useContentManager({
    getItems: getTasksByMember,
    removeItem: removeTask,
    memberId: member.id,
  });

  const sortedTasks = [...tasks].sort(compareTasks);

  return (
    <>
      <RecordSectionCard
        sectionId={RECORD_SECTION_IDS.tasks}
        title={t("title")}
        headerActions={
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        }
      >
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("no-tasks")}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {sortedTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-2 border rounded-lg p-2 bg-accent/50"
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  type="button"
                  aria-label={task.done ? t("mark-open") : t("mark-done")}
                  title={task.done ? t("mark-open") : t("mark-done")}
                  onClick={() => void setTaskDone(task.id, !task.done)}
                >
                  {task.done ? (
                    <CheckCircle2 className="text-green-600" />
                  ) : (
                    <Circle className="text-muted-foreground" />
                  )}
                </Button>
                <div className="flex-1 min-w-0 py-1">
                  <p
                    className={`text-sm font-medium ${task.done ? "line-through text-muted-foreground" : ""}`}
                  >
                    {task.title}
                  </p>
                  {task.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                      {task.notes}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    aria-label={t("edit")}
                    onClick={() => handleEdit(task)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    aria-label={t("delete")}
                    onClick={() => openDeleteDialog(task)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </RecordSectionCard>

      <TaskDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        task={editingTask}
        initialMemberId={member.id}
      />

      <ConfirmDeleteDialog
        open={!!taskToDelete}
        onOpenChange={closeDeleteDialog}
        onConfirm={handleDelete}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </>
  );
};
