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
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { LinkExistingTreeDialog } from "./LinkExistingTreeDialog";

const NONE_VALUE = "__none__";

interface Props {
  currentTreeId: string | undefined;
  value: string | null;
  memberName: string;
  /** Persisted id of the member being edited; undefined while creating a new
   *  member (linking requires an existing row on both sides). */
  memberId?: string;
  /** The form has other unsaved changes. Creating + linking persists
   *  immediately and re-hydrates the form, so it is blocked until saved. */
  formDirty?: boolean;
  onChange: (workspaceId: string | null) => void;
  /** Called after a link is established through the dialog so the caller can
   *  re-hydrate the form from the (now updated) store member. */
  onLinked?: () => void;
}

/**
 * Workspace-in-tree editor control: link this member to another tree that details
 * their own family. The user can create a brand-new tree (named after the
 * member) and link it in one step, or pick an existing accessible tree, which
 * opens a dialog to resolve a bridge person (find a matching person already
 * there, or copy this member in as a new one) — a link is never established
 * without one.
 *
 * Linking always requires a saved member: bridging touches a row in a second
 * tree, which a not-yet-saved member doesn't have yet.
 */
export const LinkedTreeField = ({
  currentTreeId,
  value,
  memberName,
  memberId,
  formDirty = false,
  onChange,
  onLinked,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode.linked-tree",
  });
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createLinkedSubtree = useWorkspaceStore((s) => s.createLinkedSubtree);
  const [creating, setCreating] = useState(false);
  const [pendingLinkTree, setPendingLinkTree] = useState<
    (typeof workspaces)[number] | null
  >(null);

  // A member cannot link to its own tree, so exclude the current one.
  const options = workspaces.filter((tr) => tr.id !== currentTreeId);
  const knownLink = options.find((tr) => tr.id === value);

  // Linking (create or find-existing) requires a saved member on this side.
  const linkingBlocked = memberId === undefined;
  // The seeded flow re-hydrates the form from the store, which would discard
  // any other in-progress edits — require a save first.
  const createBlocked = linkingBlocked || formDirty;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const name = memberName.trim() || t("new-tree-fallback-name");
      const tree = await createLinkedSubtree(memberId!, name);
      toast.success(t("toast-created-seeded", { name: tree.name }));
    } catch {
      toast.error(t("toast-create-error"));
    } finally {
      setCreating(false);
    }
  };

  const handleSelectTree = (workspaceId: string) => {
    if (workspaceId === NONE_VALUE) return;
    const tree = options.find((tr) => tr.id === workspaceId);
    if (tree) setPendingLinkTree(tree);
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
          disabled={linkingBlocked}
          onValueChange={handleSelectTree}
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
          {linkingBlocked && (
            <p className="text-xs text-muted-foreground">
              {t("save-first-hint")}
            </p>
          )}
          {!linkingBlocked && createBlocked && (
            <p className="text-xs text-muted-foreground">
              {t("create-requires-save")}
            </p>
          )}
        </>
      )}
      {pendingLinkTree && memberId && currentTreeId && (
        <LinkExistingTreeDialog
          sourceWorkspaceId={currentTreeId}
          memberId={memberId}
          memberName={memberName}
          tree={pendingLinkTree}
          open={pendingLinkTree !== null}
          onOpenChange={(open) => {
            if (!open) setPendingLinkTree(null);
          }}
          onLinked={() => {
            setPendingLinkTree(null);
            onLinked?.();
          }}
        />
      )}
    </Field>
  );
};
