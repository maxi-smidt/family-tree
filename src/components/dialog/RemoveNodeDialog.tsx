import { Member } from "@/types/member";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  members: Member[];
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const RemoveNodeDialog = ({
  members,
  isOpen,
  onConfirm,
  onCancel,
}: Props) => {
  if (members.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Member{members.length > 1 && "s"}</DialogTitle>
          <DialogDescription>
            This action will permanently delete the following members from the
            family tree. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div>
          Are you sure you want to delete:
          <ul className="list-disc ml-6 my-2">
            {members.map((m) => (
              <li key={m.id}>{`${m.firstName} ${m.lastName}`}</li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
