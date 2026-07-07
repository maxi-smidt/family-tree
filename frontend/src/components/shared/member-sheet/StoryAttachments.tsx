import {
  AttachmentIcon,
  AttachmentList,
} from "@/components/shared/attachments/AttachmentList";
import { StoryAttachment } from "@/types/story";

// Re-exported so existing importers (e.g. StoryDialog) keep working.
export { AttachmentIcon };

/** Read-only list of a story's file attachments with preview + download. */
export const StoryAttachments = ({
  attachments,
}: {
  attachments: StoryAttachment[];
}) => (
  <AttachmentList
    attachments={attachments}
    keyPrefix="sheet.member-sheet.stories.attachments"
  />
);
