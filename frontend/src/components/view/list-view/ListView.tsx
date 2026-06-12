import { useMemberStore } from "@/hooks/useMemberStore";
import { useState, useMemo } from "react";
import { Member } from "@/types/member";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown,
  MoreHorizontal,
  Search,
  Eye,
  Pencil,
  Trash2,
  Mars,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { MemberDetailDialog } from "@/components/shared/dialog/MemberDetailDialog";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { useTranslation } from "react-i18next";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { formatDate as formatLocaleDate } from "@/utils/dateUtils";
import { useTreeStore } from "@/hooks/useTreeStore";
import { isVirtualId } from "@/hooks/useTreeStore";
import { useIsMobile } from "@/hooks/useMobile";

type SortConfig = {
  key: keyof Member | "date.birth" | "date.death";
  direction: "asc" | "desc";
};

export const ListView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "list-view.view",
  });
  const { members, removeMember } = useMemberStore();
  const activeTree = useTreeStore((s) => s.selectedTree);
  const canWrite = activeTree?.role !== "viewer";
  const isVirtual = !!activeTree?.id && isVirtualId(activeTree.id);
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "firstName",
    direction: "asc",
  });
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const query = searchQuery.toLowerCase();
      return (
        member.firstName.toLowerCase().includes(query) ||
        member.lastName.toLowerCase().includes(query) ||
        (member.maidenName && member.maidenName.toLowerCase().includes(query))
      );
    });
  }, [members, searchQuery]);

  const getSortValue = (member: Member): string => {
    if (sortConfig.key === "date.birth") return member.date.birth || "";
    if (sortConfig.key === "date.death") return member.date.death || "";
    const val = member[sortConfig.key as keyof Member];
    return typeof val === "string" || typeof val === "number"
      ? String(val)
      : "";
  };

  const sortedMembers = useMemo(() => {
    const sorted = [...filteredMembers];
    sorted.sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);
      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredMembers, sortConfig]);

  const handleSort = (key: keyof Member | "date.birth" | "date.death") => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return formatLocaleDate(dateString);
  };

  const confirmDelete = () => {
    if (memberToDelete) {
      void removeMember(memberToDelete.id);
      setMemberToDelete(null);
    }
  };

  const GenderIcon = (member: Member) => {
    const size = 20;
    switch (member.gender) {
      case "m":
        return <Mars size={size} />;
      case "f":
        return <Venus size={size} />;
      default:
        return <VenusAndMars size={size} />;
    }
  };

  return (
    <ViewLayout
      title={t("title")}
      action={
        <div className="text-sm text-muted-foreground">
          {sortedMembers.length}{" "}
          {t("selected-members", { count: sortedMembers.length })}
        </div>
      }
    >
      <div className="flex items-center justify-between mb-4 p-1">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("search-placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {sortedMembers.length === 0 ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            {t("table.no-members")}
          </div>
        ) : (
          sortedMembers.map((member) => (
            <div
              key={member.id}
              className="rounded-md border bg-card p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setViewingMember(member)}
                >
                  <div className="truncate font-medium">
                    {`${member.firstName} ${member.lastName}`.trim()}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <GenderIcon {...member} />
                    </span>
                    <span>{formatDate(member.date.birth)}</span>
                    {member.date.death && (
                      <span>{formatDate(member.date.death)}</span>
                    )}
                  </div>
                  {member.maidenName && (
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                      {t("table.maiden-name")}: {member.maidenName}
                    </div>
                  )}
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewingMember(member)}
                  >
                    <span className="sr-only">{t("menu.details")}</span>
                    <Eye />
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingMember(member);
                        setIsEditMode(true);
                      }}
                    >
                      <span className="sr-only">{t("menu.edit")}</span>
                      <Pencil />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden rounded-md border flex-1 overflow-hidden md:flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("firstName")}
                    className="h-8 px-2"
                  >
                    {t("table.first-name")}
                    <ArrowUpDown />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("lastName")}
                    className="h-8 px-2"
                  >
                    {t("table.last-name")}
                    <ArrowUpDown />
                  </Button>
                </TableHead>
                <TableHead>{t("table.maiden-name")}</TableHead>
                <TableHead>{t("table.gender")}</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("date.birth")}
                    className="h-8 px-2"
                  >
                    {t("table.dob")}
                    <ArrowUpDown />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("date.death")}
                    className="h-8 px-2"
                  >
                    {t("table.dod")}
                    <ArrowUpDown />
                  </Button>
                </TableHead>
                {isVirtual && (
                  <TableHead>{t("table.source-tree")}</TableHead>
                )}
                <TableHead className="w-12.5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isVirtual ? 8 : 7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {t("table.no-members")}
                  </TableCell>
                </TableRow>
              ) : (
                sortedMembers.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.firstName}
                    </TableCell>
                    <TableCell>{member.lastName}</TableCell>
                    <TableCell>{member.maidenName || "-"}</TableCell>
                    <TableCell className="capitalize">
                      <GenderIcon {...member} />
                    </TableCell>
                    <TableCell>{formatDate(member.date.birth)}</TableCell>
                    <TableCell>{formatDate(member.date.death)}</TableCell>
                    {isVirtual && (
                      <TableCell>
                        {member.sourceTreeName ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground border border-border">
                            {member.sourceTreeName}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost">
                            <span className="sr-only">{t("menu.trigger")}</span>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>
                            {t("menu.actions")}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => {
                              setViewingMember(member);
                            }}
                          >
                            <Eye />
                            {t("menu.details")}
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingMember(member);
                                  setIsEditMode(true);
                                }}
                              >
                                <Pencil />
                                {t("menu.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setMemberToDelete(member)}
                              >
                                <Trash2 />
                                {t("menu.delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <MemberSheet
        isOpen={!!editingMember}
        onClose={() => setEditingMember(null)}
        member={editingMember}
        initialEditMode={isEditMode}
        canEdit={canWrite}
      />

      {isMobile ? (
        <MemberSheet
          isOpen={!!viewingMember}
          onClose={() => setViewingMember(null)}
          member={viewingMember}
          canEdit={canWrite}
        />
      ) : (
        <MemberDetailDialog
          member={viewingMember}
          open={!!viewingMember}
          onOpenChange={(open) => !open && setViewingMember(null)}
        />
      )}

      <RemoveMemberDialog
        isOpen={!!memberToDelete}
        members={memberToDelete ? [memberToDelete] : []}
        onConfirm={confirmDelete}
        onCancel={() => setMemberToDelete(null)}
      />
    </ViewLayout>
  );
};
