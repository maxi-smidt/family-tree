import { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { ContentCard } from "@/components/shared/content/ContentCard";

interface CollapsibleStoryProps {
  title: string;
  date?: string | null;
  content?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A member-sheet story using the same narrative-content presentation as events. */
export const CollapsibleStory = (props: CollapsibleStoryProps) => (
  <ContentCard
    icon={BookOpen}
    title={props.title}
    date={props.date}
    description={props.content}
    actions={props.actions}
    className={props.className}
    collapsible
  >
    {props.children}
  </ContentCard>
);
