import { useState, useEffect } from "react";
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
import { Story, StoryInput } from "@/types/story";

interface StoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  story?: Story | null;
  memberId?: string;
}

export const StoryDialog = ({
  open,
  onOpenChange,
  story,
  memberId,
}: StoryDialogProps) => {
  const { addStory, updateStory } = useStoryStore();
  const [formData, setFormData] = useState<StoryInput>({
    title: "",
    content: "",
  });

  useEffect(() => {
    if (story) {
      setFormData({
        title: story.title,
        content: story.content,
      });
    } else {
      setFormData({
        title: "",
        content: "",
      });
    }
  }, [story, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (story) {
      await updateStory(story.id, formData);
    } else if (memberId) {
      await addStory(memberId, formData);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{story ? "Edit Story" : "Add Story"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 py-4 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="e.g., Early Life, War Years, Marriage Story"
                required
              />
            </div>

            <div className="space-y-2 flex-1">
              <Label htmlFor="content">Story *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder="Write the story or biography here..."
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!formData.title || !formData.content || !memberId}
            >
              {story ? "Update" : "Add"} Story
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
