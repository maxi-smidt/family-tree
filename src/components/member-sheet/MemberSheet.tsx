import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Member } from "@/types/member";
import { useEffect, useState } from "react";
import { ViewMode } from "./ViewMode";
import { EditMode } from "./EditMode";
import { Button } from "@/components/ui/button";
import { ExternalLink, Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MemberDetailDialog } from "@/components/member-detail/MemberDetailDialog";

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
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet",
  });
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  useEffect(() => {
    setIsEditMode(initialEditMode);
  }, [initialEditMode, isOpen]);

  if (!member) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-100 sm:w-135" showCloseButton={false}>
        <SheetHeader className="border-b">
          <div className="pr-10">
            <SheetTitle>
              {isEditMode ? t("edit-title") : t("detail-title")}
            </SheetTitle>
            <SheetDescription>
              {isEditMode ? t("edit-description") : t("detail-description")}
            </SheetDescription>
          </div>
          <div className="absolute top-4 right-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsEditMode((value) => !value)}
            >
              {isEditMode ? <Eye /> : <Pencil />}
            </Button>
          </div>
        </SheetHeader>

        <div className="relative flex-1 overflow-hidden flex flex-col">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetailDialogOpen(true)}
            className="absolute top-2 right-2 z-10"
          >
            <ExternalLink />
            {t("view-details")}
          </Button>

          <div className="p-4 overflow-y-auto flex-1">
            {isEditMode ? (
              <EditMode member={member} />
            ) : (
              <ViewMode member={member} />
            )}
          </div>
        </div>

        {isEditMode && (
          <SheetFooter className="mt-auto p-4 border-t bg-background">
            <Button
              type="submit"
              form="edit-member-form"
              className="w-full"
              size="sm"
            >
              {t("save")}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
      <MemberDetailDialog
        member={member}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </Sheet>
  );
};
