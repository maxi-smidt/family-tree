import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTreeStore } from "@/hooks/useTreeStore";

const NONE_VALUE = "__none__";

interface Props {
  currentTreeId: string | undefined;
  value: string | null;
  memberName: string;
  /** Persisted id of the member being edited; undefined while creating a new
   *  member (the seeded create-and-link flow needs an existing row). */
  memberId?: string;
  /** The form has other unsaved changes. Creating + linking persists
   *  immediately and re-hydrates the form, so it is blocked until saved. */
  formDirty?: boolean;
  onChange: (treeId: string | null) => void;
}

/**
 * Tree-in-tree editor control: link this member to another tree that details
 * their own family. The user can pick an existing accessible tree or create a
 * brand-new tree (named after the member) and link it in one step.
 *
 * For a persisted member the create action is atomic on the backend: the new
 * tree is seeded with a copy of this person (the "bridge person") and both
 * rows are linked bidirectionally — the store member updates and the form
 * re-hydrates with the link already set. For a not-yet-saved member the tree
 * is created empty and the link is persisted when the member form saves.
 */
export const LinkedTreeField = ({
  currentTreeId,
  value,
  memberName,
  memberId,
  formDirty = false,
  onChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode.linked-tree",
  });
  const trees = useTreeStore((s) => s.trees);
  const createTree = useTreeStore((s) => s.createTree);
  const createLinkedSubtree = useTreeStore((s) => s.createLinkedSubtree);
  const [creating, setCreating] = useState(false);

  // A member cannot link to its own tree, so exclude the current one.
  const options = trees.filter((tr) => tr.id !== currentTreeId);
  const knownLink = options.find((tr) => tr.id === value);

  // The seeded flow re-hydrates the form from the store, which would discard
  // any other in-progress edits — require a save first.
  const createBlocked = memberId !== undefined && formDirty;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const name = memberName.trim() || t("new-tree-fallback-name");
      if (memberId) {
        const tree = await createLinkedSubtree(memberId, name);
        toast.success(t("toast-created-seeded", { name: tree.name }));
      } else {
        const tree = await createTree(name, undefined, { select: false });
        onChange(tree.id);
        toast.success(t("toast-created", { name: tree.name }));
      }
    } catch {
      toast.error(t("toast-create-error"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Field>
      <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
        {t("field-label")}
      </FieldLabel>
      <p className="text-xs text-muted-foreground">{t("field-hint")}</p>
      <div className="flex items-center gap-2">
        <Select
          value={value ?? NONE_VALUE}
          onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
        >
          <SelectTrigger className="h-7 flex-1 text-xs!">
            <SelectValue placeholder={t("placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t("none")}</SelectItem>
            {options.map((tr) => (
              <SelectItem key={tr.id} value={tr.id}>
                {tr.name}
              </SelectItem>
            ))}
            {/* The link can point at a tree that is not in the user's own list
                (e.g. one shared with them later removed); keep it selectable. */}
            {value && !knownLink && (
              <SelectItem value={value}>{t("external-tree")}</SelectItem>
            )}
          </SelectContent>
        </Select>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(null)}
            aria-label={t("unlink")}
          >
            <X />
          </Button>
        )}
      </div>
      {!value && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-fit"
            disabled={creating || createBlocked}
            onClick={() => void handleCreate()}
          >
            <Plus />
            {t("create-and-link")}
          </Button>
          {createBlocked && (
            <p className="text-xs text-muted-foreground">
              {t("create-requires-save")}
            </p>
          )}
        </>
      )}
    </Field>
  );
};
