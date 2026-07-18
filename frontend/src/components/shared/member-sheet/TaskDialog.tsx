import { useState, useEffect, useCallback, FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { toast } from "sonner";
import { ResearchTask } from "@/types/task";
import { useTranslation } from "react-i18next";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { getMemberOptions } from "@/utils/memberUtils";

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: ResearchTask | null;
  /** Member preselected for a new task; omit for a general (tree-level) task. */
  initialMemberId?: string;
}

export const TaskDialog = ({
  open,
  onOpenChange,
  task,
  initialMemberId,
}: TaskDialogProps) => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.tasks.dialog",
  });
  const { addTask, updateTask } = useTaskStore();
  const { members } = useMemberStore();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<{
    title: string;
    notes: string;
    selectedMemberIds: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setInitialSnapshot(null);
      return;
    }
    const snap = task
      ? {
          title: task.title,
          notes: task.notes,
          selectedMemberIds: task.linkedMemberIds,
        }
      : {
          title: "",
          notes: "",
          selectedMemberIds: initialMemberId ? [initialMemberId] : [],
        };
    setInitialSnapshot(snap);
    setTitle(snap.title);
    setNotes(snap.notes);
    setSelectedMemberIds(snap.selectedMemberIds);
  }, [task, initialMemberId, open]);

  const isDirty =
    initialSnapshot !== null &&
    (title !== initialSnapshot.title ||
      notes !== initialSnapshot.notes ||
      JSON.stringify(selectedMemberIds) !==
        JSON.stringify(initialSnapshot.selectedMemberIds));

  const save = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      if (task) {
        await updateTask(task.id, { title, notes }, selectedMemberIds);
      } else {
        await addTask(selectedMemberIds, { title, notes });
      }
      onOpenChange(false);
      return true;
    } catch {
      toast.error(t("error-save"));
      return false;
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    task,
    title,
    notes,
    selectedMemberIds,
    addTask,
    updateTask,
    onOpenChange,
  ]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Stop the submit from bubbling through the portal to the surrounding
    // member-edit form, which would save the member and close the sheet.
    e.stopPropagation();
    void save();
  };

  useUnsavedGuard("task", isDirty, save);

  const memberOptions = getMemberOptions(members, (name) =>
    i18n.t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>{task ? t("title-edit") : t("title-add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 py-4 px-1">
            <div className="space-y-2">
              <Label htmlFor="task-title">{t("title")} *</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("title-placeholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-members">{t("linked-members")}</Label>
              <MultiSelect
                options={memberOptions}
                onValueChange={setSelectedMemberIds}
                defaultValue={selectedMemberIds}
                placeholder={t("linked-members-placeholder")}
                variant="inverted"
                maxCount={5}
                hideSelectedOptions
              />
              <p className="text-xs text-muted-foreground">
                {t("linked-members-description")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-notes">{t("notes")}</Label>
              <Textarea
                id="task-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notes-placeholder")}
                rows={4}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !title}>
              {task ? t("update") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
