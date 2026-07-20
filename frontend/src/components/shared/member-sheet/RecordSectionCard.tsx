import { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { useMemberSheetSectionsStore } from "@/hooks/useMemberSheetSectionsStore";

/** Stable ids shared between view and edit mode for the same Records-tab section. */
export const RECORD_SECTION_IDS = {
  gallery: "gallery",
  events: "events",
  stories: "stories",
  documents: "documents",
  diseases: "diseases",
  tasks: "tasks",
} as const;

export type RecordSectionId =
  (typeof RECORD_SECTION_IDS)[keyof typeof RECORD_SECTION_IDS];

type Props = {
  sectionId: RecordSectionId;
  title: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
};

/**
 * A Records-tab section card whose whole body (not just an inner list, see
 * `CollapsibleSection`) can be collapsed via its header. Collapse state is
 * persisted per section id. `children` unmount while collapsed, so anything
 * that must stay mounted regardless of collapse state (e.g. a file input
 * driven by a ref) needs to be rendered outside this component instead.
 */
export const RecordSectionCard = ({
  sectionId,
  title,
  headerActions,
  children,
}: Props) => {
  const collapsed = useMemberSheetSectionsStore(
    (s) => s.collapsedSections[sectionId] ?? false,
  );
  const toggleSection = useMemberSheetSectionsStore((s) => s.toggleSection);

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => toggleSection(sectionId)}
            className="flex min-w-0 items-center gap-1.5 text-left"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            )}
            <ItemTitle className="truncate">{title}</ItemTitle>
          </button>
          {headerActions}
        </div>
        {!collapsed && children}
      </ItemContent>
    </Item>
  );
};
