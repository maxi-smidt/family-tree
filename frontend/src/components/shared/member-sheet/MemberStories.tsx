import { Member } from "@/types/member";
import { useStoryStore } from "@/hooks/useStoryStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { StoryDialog } from "./StoryDialog";
import { useTranslation } from "react-i18next";
import { useContentManager } from "@/hooks/useContentManager";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";

type Props = {
  member: Member;
};

export const MemberStories = ({ member }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.stories",
  });
  const { getStoriesByMember, removeStory } = useStoryStore();
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);

  const {
    items: stories,
    isDialogOpen,
    setIsDialogOpen,
    editingItem: editingStory,
    itemToDelete: storyToDelete,
    handleAdd,
    handleEdit,
    handleDelete,
    openDeleteDialog,
    closeDeleteDialog,
  } = useContentManager({
    getItems: getStoriesByMember,
    removeItem: removeStory,
    memberId: member.id,
  });

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{t("title")}</ItemTitle>
          <Button size="sm" variant="ghost" type="button" onClick={handleAdd}>
            <Plus />
            {t("add")}
          </Button>
        </div>

        {stories.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("no-stories")}
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
                        type="button"
                        onClick={() => handleEdit(story)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => openDeleteDialog(story)}
                      >
                        <Trash2 />
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
                      type="button"
                      className="mt-1 p-0 h-auto"
                      onClick={() =>
                        setExpandedStoryId(isExpanded ? null : story.id)
                      }
                    >
                      {isExpanded ? t("show-less") : t("read-more")}
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
        initialMemberId={member.id}
      />

      <ConfirmDeleteDialog
        open={!!storyToDelete}
        onOpenChange={closeDeleteDialog}
        onConfirm={handleDelete}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />
    </Item>
  );
};
