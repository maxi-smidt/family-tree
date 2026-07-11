import { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { ContentCard } from "@/components/shared/content/ContentCard";

interface CollapsibleEventProps {
  icon: LucideIcon;
  typeLabel: string;
  date: string;
  location?: string | null;
  description?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A member-sheet event using the shared narrative-content presentation. */
export const CollapsibleEvent = (props: CollapsibleEventProps) => (
  <ContentCard
    icon={props.icon}
    title={props.typeLabel}
    date={props.date}
    location={props.location}
    description={props.description}
    actions={props.actions}
    className={props.className}
    collapsible
  >
    {props.children}
  </ContentCard>
);
