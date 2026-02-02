import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ImportChoice = "overwrite" | "keep" | "cancel";

type Props = {
  isOpen: boolean;
  onChoice: (choice: ImportChoice) => void;
};

export const ImportDatabaseDialog = ({ isOpen, onChoice }: Props) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onChoice("cancel")}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import database conflict</DialogTitle>
          <DialogDescription>
            A database with the same ID already exists. Please decide what to
            do.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChoice("cancel")}
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onChoice("overwrite")}
          >
            Overwrite
          </Button>
          <Button variant="default" size="sm" onClick={() => onChoice("keep")}>
            Keep both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
