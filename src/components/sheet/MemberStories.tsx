import { Member } from "@/types/member";
import { useStoryStore } from "@/hooks/useStoryStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { StoryDialog } from "./StoryDialog";
import { Story } from "@/types/story";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  member: Member;
};

export const MemberStories = ({ member }: Props) => {
  const { getStoriesByMember, removeStory } = useStoryStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [storyToDelete, setStoryToDelete] = useState<Story | null>(null);
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);

  const stories = getStoriesByMember(member.id);

  const handleAddStory = () => {
    setEditingStory(null);
    setIsDialogOpen(true);
  };

  const handleEditStory = (story: Story) => {
    setEditingStory(story);
    setIsDialogOpen(true);
  };

  const handleDeleteStory = async () => {
    if (storyToDelete) {
      await removeStory(storyToDelete.id);
      setStoryToDelete(null);
    }
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>Stories & Biographies</ItemTitle>
          <Button size="sm" variant="ghost" onClick={handleAddStory}>
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>

        {stories.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No stories written yet
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {stories.map((story) => {
              const isExpanded = expandedStoryId === story.id;
              const shouldTruncate = story.content.length > 200;

              return (
                <div
                  key={story.id}
                  className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <h4 className="font-medium">{story.title}</h4>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditStory(story)}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStoryToDelete(story)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="text-sm whitespace-pre-wrap">
                    {isExpanded || !shouldTruncate
                      ? story.content
                      : truncateText(story.content, 200)}
                  </div>

                  {shouldTruncate && (
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 p-0 h-auto"
                      onClick={() =>
                        setExpandedStoryId(isExpanded ? null : story.id)
                      }
                    >
                      {isExpanded ? "Show less" : "Read more"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ItemContent>

      <StoryDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        story={editingStory}
        memberId={member.id}
      />

      <AlertDialog
        open={!!storyToDelete}
        onOpenChange={(open) => !open && setStoryToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Story</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this story? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStory}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Item>
  );
};
