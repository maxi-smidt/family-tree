import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { SectionDB } from "@/types/section";
import { MemberDB, WorkspaceSearchHitDB } from "@/types/member";
import { getMemberFullName, formatMemberSubLabel } from "@/utils/memberUtils";

const SEARCH_DEBOUNCE_MS = 300;

interface SectionMembersDialogProps {
  section: SectionDB | null;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
}

/** Membership editing (#990): add/remove members of a section, with each
 *  search hit's existing section memberships visible so an addition's
 *  overlap with other sections is never a surprise. `PUT .../members` is a
 *  full replace, so this loads the current roster first and saves the
 *  edited list back in one call. */
export const SectionMembersDialog = ({
  section,
  workspaceId,
  onOpenChange,
}: SectionMembersDialogProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.section-members",
  });
  const { t: tSearch } = useTranslation(undefined, {
    keyPrefix: "workspace-nav.search",
  });
  const getSectionMembers = useSectionStore((s) => s.getSectionMembers);
  const setSectionMembers = useSectionStore((s) => s.setSectionMembers);
  const searchWorkspace = useMemberStore((s) => s.searchWorkspace);

  const [members, setMembers] = useState<MemberDB[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WorkspaceSearchHitDB[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!section) {
      setMembers(null);
      setQuery("");
      setHits([]);
      setError(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    getSectionMembers(section.id)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("load-error"));
      });
    return () => {
      cancelled = true;
    };
  }, [section, getSectionMembers, t]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await searchWorkspace(workspaceId, trimmed, 10);
          if (!cancelled) setHits(result.items);
        } catch {
          if (!cancelled) setHits([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, workspaceId, searchWorkspace]);

  const memberIds = useMemo(
    () => new Set((members ?? []).map((m) => m.id)),
    [members],
  );

  const handleRemove = (memberId: string) => {
    setMembers((prev) => (prev ?? []).filter((m) => m.id !== memberId));
  };

  const handleAdd = (hit: WorkspaceSearchHitDB) => {
    if (memberIds.has(hit.id)) return;
    setMembers((prev) =>
      [...(prev ?? []), hit].sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      ),
    );
  };

  const handleSave = async () => {
    if (!section || !members) return;
    setSaving(true);
    setError(null);
    try {
      await setSectionMembers(
        section.id,
        members.map((m) => m.id),
      );
      onOpenChange(false);
    } catch {
      setError(t("save-error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={section !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { name: section?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              placeholder={t("add-placeholder")}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-8 pr-8 text-sm"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setQuery("")}
                aria-label={tSearch("clear")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {query.trim() && (
            <div className="max-h-40 overflow-y-auto rounded-md border bg-popover text-popover-foreground">
              {searching && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {tSearch("searching")}
                </div>
              )}
              {!searching && hits.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {tSearch("no-results")}
                </div>
              )}
              {!searching &&
                hits.map((hit) => {
                  const alreadyIn = memberIds.has(hit.id);
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      disabled={alreadyIn}
                      className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-50"
                      onClick={() => handleAdd(hit)}
                    >
                      <span className="font-medium">
                        {getMemberFullName(hit) || tSearch("unnamed")}
                      </span>
                      {hit.sections.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {hit.sections.map((s) => (
                            <Badge key={s.id} variant="secondary">
                              {s.name}
                            </Badge>
                          ))}
                        </span>
                      )}
                      {alreadyIn && (
                        <span className="text-xs text-muted-foreground">
                          {t("already-in")}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {members === null && !loadError && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("loading")}
            </p>
          )}
          {loadError && (
            <p className="px-3 py-2 text-sm text-destructive">{loadError}</p>
          )}
          {members !== null && members.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("no-members")}
            </p>
          )}
          {members !== null && members.length > 0 && (
            <ul>
              {members.map((m) => {
                const sublabel = formatMemberSubLabel(
                  m.maidenName,
                  m.dateOfBirth,
                  (name) => tSearch("nee", { name }),
                );
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {getMemberFullName(m)}
                      </div>
                      {sublabel && (
                        <div className="truncate text-xs text-muted-foreground">
                          {sublabel}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemove(m.id)}
                      aria-label={t("remove", { name: getMemberFullName(m) })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || members === null}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
