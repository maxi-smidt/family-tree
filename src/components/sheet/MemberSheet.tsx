import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Member } from "@/types/member";
import { useEffect, useState } from "react";
import { ViewMode } from "./ViewMode";
import { EditMode } from "./EditMode";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";

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
    setIsEditMode(initialEditMode);
  }, [initialEditMode, isOpen]);

  if (!member) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-100 sm:w-135 flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-4 border-b flex flex-row items-center justify-between space-y-0">
          <div>
            <SheetTitle>
              {isEditMode ? "Edit Member" : "Member Details"}
            </SheetTitle>
            <SheetDescription>
              {isEditMode
                ? "Update the member's information."
                : "View detailed information about this family member."}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-2">
            {!isEditMode && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditMode(true)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {isEditMode && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditMode(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        {isEditMode ? (
          <EditMode member={member} />
        ) : (
          <ViewMode member={member} />
        )}
      </SheetContent>
    </Sheet>
  );
};
