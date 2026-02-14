import { useState, useEffect, FormEvent } from "react";
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
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { Story, StoryInput } from "@/types/story";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTranslation } from "react-i18next";

interface StoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  story?: Story | null;
  initialMemberId?: string;
}

export const StoryDialog = ({
  open,
  onOpenChange,
  story,
  initialMemberId,
}: StoryDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.stories.dialog",
  });
  const { addStory, updateStory } = useStoryStore();
  const { members } = useMemberStore();
  const [formData, setFormData] = useState<StoryInput>({
    title: "",
    content: "",
  });
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (story) {
      setFormData({
        title: story.title,
        content: story.content,
      });
      setSelectedMemberIds(story.linkedMemberIds || []);
    } else {
      setFormData({
        title: "",
        content: "",
      });
      setSelectedMemberIds(initialMemberId ? [initialMemberId] : []);
    }
  }, [story, initialMemberId, open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (story) {
      await updateStory(story.id, formData, selectedMemberIds);
    } else {
      await addStory(selectedMemberIds, formData);
    }

    onOpenChange(false);
  };

  const memberOptions = members.map((m) => ({
    label: `${m.firstName} ${m.lastName}`,
    value: m.id,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{story ? t("title-edit") : t("title-add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 py-4 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="members">{t("linked-members")} *</Label>
              <MultiSelect
                options={memberOptions}
                onValueChange={setSelectedMemberIds}
                defaultValue={selectedMemberIds}
                placeholder={t("linked-members-placeholder")}
                variant="inverted"
                maxCount={5}
              />
              <p className="text-xs text-muted-foreground">
                {t("linked-members-description")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">{t("title")} *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder={t("title-placeholder")}
                required
              />
            </div>

            <div className="space-y-2 flex-1">
              <Label htmlFor="content">{t("story")} *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder={t("story-placeholder")}
                rows={15}
                className="resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                {formData.content.length} characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !formData.title ||
                !formData.content ||
                selectedMemberIds.length === 0
              }
            >
              {story ? t("update") : t("add")} Story
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
