import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Member } from "@/types/member";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EditMode } from "@/components/tree-view/member-sheet/EditMode";
import { ViewMode } from "@/components/tree-view/member-sheet/ViewMode";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  initialEditMode?: boolean;
};

export const MemberSheet = ({
  isOpen,
  onClose,
  member,
  initialEditMode = false,
}: Props) => {
  const [isEditMode, setIsEditMode] = useState(initialEditMode);

  useEffect(() => {
    if (isOpen) {
      setIsEditMode(initialEditMode);
    }
  }, [isOpen, initialEditMode]);

  if (!member) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader className="pr-10 pt-3">
          <div className="flex items-start justify-between gap-4">
            <SheetTitle className="line-clamp-2 text-ellipsis overflow-hidden text-left mt-1">
              {member.firstName} {member.lastName}
            </SheetTitle>
            <div className="flex items-center gap-2 shrink-0 mt-1">
              <Label htmlFor="edit-mode" className="whitespace-nowrap">
                Edit Mode
              </Label>
              <Switch
                id="edit-mode"
                checked={isEditMode}
                onCheckedChange={setIsEditMode}
              />
            </div>
          </div>
          <SheetDescription>
            {isEditMode
              ? "Make changes to the family member here. Click save when you're done."
              : "View details of the family member."}
          </SheetDescription>
        </SheetHeader>
        {isEditMode ? (
          <EditMode member={member} />
        ) : (
          <div className="px-4 pb-4 flex-1 overflow-y-auto">
            <ViewMode member={member} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
