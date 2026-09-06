import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { IdentityLinkClaim } from "@/types/identityLink";
import { MemberDB } from "@/types/member";

type Props = {
  claim: IdentityLinkClaim | null;
  onOpenChange: (open: boolean) => void;
};

/** Pick one of your own members to resolve an incoming identity link claim
 *  (#1014's opaque flow) — never lets the proposer choose for you. */
export const CompleteIdentityLinkClaimDialog = ({
  claim,
  onOpenChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "identity-links-view.complete-dialog",
  });
  const ownedWorkspaces = useWorkspaceStore((s) =>
    s.workspaces.filter((w) => w.role === "owner"),
  );
  const completeClaim = useIdentityLinkStore((s) => s.completeClaim);
  const searchMembers = useMemberStore((s) => s.searchMembers);

  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberDB[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!claim) {
      setWorkspaceId("");
      setQuery("");
      setResults([]);
    }
  }, [claim]);

  useEffect(() => {
    const term = query.trim();
    if (!workspaceId || !term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      void searchMembers(workspaceId, term)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [workspaceId, query, searchMembers]);

  if (!claim) return null;

  const handlePick = async (memberId: string) => {
    setSubmitting(true);
    try {
      await completeClaim(claim.id, workspaceId, memberId);
      toast.success(t("success"));
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={claim !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("title", { username: claim.proposer_username ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("workspace-placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {ownedWorkspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {workspaceId && (
            <>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder={t("search-placeholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {query.trim() && !searching && results.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("no-results")}
                  </p>
                )}
                {results.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={submitting}
                    className="w-full rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    onClick={() => void handlePick(m.id)}
                  >
                    {m.firstName} {m.lastName}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
