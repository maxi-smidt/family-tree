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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { Member, MemberSearchHitDB } from "@/types/member";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  member: Member;
};

/** Propose an identity link, either by finding the exact target member in a
 *  workspace the caller can already read (search) or, when they can't,
 *  by inviting the target owner to pick their own member (#1014). */
export const ProposeIdentityLinkDialog = ({
  open,
  onOpenChange,
  workspaceId,
  member,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.identity-links.propose-dialog",
  });
  const searchOtherTrees = useMemberStore((s) => s.searchOtherTrees);
  const propose = useIdentityLinkStore((s) => s.propose);
  const proposeClaim = useIdentityLinkStore((s) => s.proposeClaim);

  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchHitDB[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setUsername("");
      setNote("");
      setTab("search");
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      void searchOtherTrees(term, workspaceId)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, workspaceId, searchOtherTrees]);

  const handlePick = async (hit: MemberSearchHitDB) => {
    setSubmitting(true);
    try {
      await propose(workspaceId, member.id, hit.workspaceId, hit.id);
      toast.success(t("propose-success"));
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("propose-error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = async () => {
    if (!username.trim()) return;
    setSubmitting(true);
    try {
      await proposeClaim(
        workspaceId,
        member.id,
        username.trim(),
        note.trim() || undefined,
      );
      toast.success(t("invite-success"));
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("invite-error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("title", {
              name: `${member.firstName} ${member.lastName}`.trim(),
            })}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="search">{t("tab-search")}</TabsTrigger>
            <TabsTrigger value="invite">{t("tab-invite")}</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-3">
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
              {results.map((hit) => (
                <button
                  key={`${hit.workspaceId}:${hit.id}`}
                  type="button"
                  disabled={submitting}
                  className="w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                  onClick={() => void handlePick(hit)}
                >
                  <div className="text-sm font-medium">
                    {hit.firstName} {hit.lastName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {hit.workspaceName}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="invite" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("invite-description")}
            </p>
            <Input
              placeholder={t("username-placeholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Textarea
              placeholder={t("note-placeholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <Button
              className="w-full"
              disabled={submitting || !username.trim()}
              onClick={() => void handleInvite()}
            >
              {t("invite-submit")}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
