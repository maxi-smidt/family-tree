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
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { toast } from "sonner";
import { Story, StoryInput } from "@/types/story";
import { MultiSelect } from "@/components/ui/multi-select";
import { useTranslation } from "react-i18next";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { getMemberOptions } from "@/utils/memberUtils";
import { DocumentLinkField } from "./DocumentLinkField";

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
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.stories.dialog",
  });
  const { addStory, updateStory } = useStoryStore();
  const { members } = useMemberStore();
  const [formData, setFormData] = useState<StoryInput>({
    title: "",
    content: "",
  });
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [initialSnapshot, setInitialSnapshot] = useState<{
    formData: StoryInput;
    selectedMemberIds: string[];
    selectedDocumentIds: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setInitialSnapshot(null);
      return;
    }
    if (story) {
      const snap = {
        formData: { title: story.title, content: story.content },
        selectedMemberIds: story.linkedMemberIds || [],
        selectedDocumentIds: story.documentIds || [],
      };
      setInitialSnapshot(snap);
      setFormData(snap.formData);
      setSelectedMemberIds(snap.selectedMemberIds);
      setSelectedDocumentIds(snap.selectedDocumentIds);
    } else {
      const ids = initialMemberId ? [initialMemberId] : [];
      setInitialSnapshot({
        formData: { title: "", content: "" },
        selectedMemberIds: ids,
        selectedDocumentIds: [],
      });
      setFormData({ title: "", content: "" });
      setSelectedMemberIds(ids);
      setSelectedDocumentIds([]);
    }
  }, [story, initialMemberId, open]);

  const isDirty =
    initialSnapshot !== null &&
    (formData.title !== initialSnapshot.formData.title ||
      formData.content !== initialSnapshot.formData.content ||
      JSON.stringify(selectedMemberIds) !==
        JSON.stringify(initialSnapshot.selectedMemberIds) ||
      JSON.stringify(selectedDocumentIds) !==
        JSON.stringify(initialSnapshot.selectedDocumentIds));

  const save = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      if (story) {
        await updateStory(
          story.id,
          formData,
          selectedMemberIds,
          selectedDocumentIds,
        );
      } else {
        await addStory(selectedMemberIds, formData, selectedDocumentIds);
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
    story,
    formData,
    selectedMemberIds,
    selectedDocumentIds,
    addStory,
    updateStory,
    onOpenChange,
  ]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  useUnsavedGuard("story", isDirty, save);

  const memberOptions = getMemberOptions(members, (name) =>
    i18n.t("common.nee", { name }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{story ? t("title-edit") : t("title-add")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 flex flex-col flex-1 min-h-0"
        >
          <div className="space-y-4 py-4 px-1 flex-1 overflow-y-auto">
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

            <div className="space-y-2">
              <Label htmlFor="content">{t("story")}</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder={t("story-placeholder")}
                rows={10}
                className="resize-none"
              />
            </div>

            <DocumentLinkField
              documentIds={selectedDocumentIds}
              onChange={setSelectedDocumentIds}
              seedMemberIds={selectedMemberIds}
            />
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
            <Button
              type="submit"
              size="sm"
              disabled={
                submitting || !formData.title || selectedMemberIds.length === 0
              }
            >
              {story ? t("update") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
