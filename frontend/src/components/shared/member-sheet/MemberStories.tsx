import { Member } from "@/types/member";
import { useStoryStore } from "@/hooks/useStoryStore";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { StoryDialog } from "./StoryDialog";
import { LinkedDocumentList } from "./LinkedDocumentList";
import { CollapsibleStory } from "./CollapsibleStory";
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
            {stories.map((story) => (
              <CollapsibleStory
                key={story.id}
                title={story.title}
                content={story.content}
                actions={
                  <>
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
                  </>
                }
              >
                <LinkedDocumentList documentIds={story.documentIds} />
              </CollapsibleStory>
            ))}
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
