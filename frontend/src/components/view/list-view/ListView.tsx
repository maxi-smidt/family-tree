import { useMemberStore } from "@/hooks/useMemberStore";
import { useState, useMemo, useEffect } from "react";
import { Member, isDeceased } from "@/types/member";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Mars,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { EditableCell } from "./EditableCell";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { MemberDetailDialog } from "@/components/shared/dialog/MemberDetailDialog";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { useTranslation } from "react-i18next";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { formatDate as formatLocaleDate, getYear } from "@/utils/dateUtils";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useIsMobile } from "@/hooks/useMobile";
import { Skeleton } from "@/components/ui/skeleton";
import { useListSettings, normalizeOrder } from "@/hooks/useListSettings";
import { COLUMN_MAP, type ListColumnId } from "./columns";
import { ListCustomizePopover } from "./ListCustomizePopover";
import {
  ListFilters,
  type ListFilterState,
  DEFAULT_FILTERS,
} from "./ListFilters";
import { ListPagination } from "./ListPagination";
import { toCsv, downloadCsv } from "@/utils/csvUtils";

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

const SKELETON_ROWS = 6;

function computeAge(member: Member): { age: number | null; atDeath: boolean } {
  const birthYear = getYear(member.date.birth);
  if (!birthYear) return { age: null, atDeath: false };
  const deathYear = getYear(member.date.death);
  if (deathYear !== null) return { age: deathYear - birthYear, atDeath: true };
  if (!isDeceased(member))
    return { age: new Date().getFullYear() - birthYear, atDeath: false };
  return { age: null, atDeath: false };
}

export const ListView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "list-view.view" });
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: "common" });

  const { members, removeMember } = useMemberStore();
  const activeTree = useWorkspaceStore((s) => s.selectedTree);
  const isReady = useWorkspaceStore((s) => s.isReady);
  const canWrite = activeTree?.role !== "viewer";
  const isMobile = useIsMobile();

  const { order, hidden, pageSize, setPageSize } = useListSettings();

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ListFilterState>(DEFAULT_FILTERS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "firstName",
    direction: "asc",
  });
  const [page, setPage] = useState(0);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [inlineEdit, setInlineEdit] = useState(false);

  const canInlineEdit = canWrite && !isMobile;
  const inlineEditActive = inlineEdit && canInlineEdit;

  const EDITABLE_COLUMNS = new Set<ListColumnId>([
    "firstName",
    "lastName",
    "maidenName",
    "gender",
    "birthplace",
    "hometown",
    "cemetery",
    "birth",
    "death",
  ]);

  // Reset inline edit when the user loses write access (e.g. switches to a viewer tree).
  useEffect(() => {
    if (!canInlineEdit) setInlineEdit(false);
  }, [canInlineEdit]);

  // Reset to first page whenever filters, search, or sort change.
  useEffect(() => {
    setPage(0);
  }, [
    searchQuery,
    filters.gender,
    filters.status,
    filters.hasPhoto,
    sortConfig.key,
    sortConfig.direction,
  ]);

  // Map from member id → number of children.
  const childrenCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      if (m.parents.paternalParent) {
        map.set(
          m.parents.paternalParent,
          (map.get(m.parents.paternalParent) ?? 0) + 1,
        );
      }
      if (
        m.parents.maternalParent &&
        m.parents.maternalParent !== m.parents.paternalParent
      ) {
        map.set(
          m.parents.maternalParent,
          (map.get(m.parents.maternalParent) ?? 0) + 1,
        );
      }
    }
    return map;
  }, [members]);

  // Columns visible in the desktop table (respects user settings).
  const visibleColumns = useMemo(
    () => normalizeOrder(order).filter((id) => !hidden.includes(id)),
    [order, hidden],
  );

  const filteredMembers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return members.filter((m) => {
      if (
        query &&
        !m.firstName.toLowerCase().includes(query) &&
        !m.lastName.toLowerCase().includes(query) &&
        !(m.maidenName && m.maidenName.toLowerCase().includes(query))
      )
        return false;
      if (filters.gender !== "all" && m.gender !== filters.gender) return false;
      if (filters.status === "alive" && isDeceased(m)) return false;
      if (filters.status === "deceased" && !isDeceased(m)) return false;
      if (filters.hasPhoto && !m.imageData) return false;
      return true;
    });
  }, [members, searchQuery, filters]);

  const getComparable = (member: Member): string | number => {
    if (sortConfig.key === "age") return computeAge(member).age ?? -1;
    if (sortConfig.key === "childrenCount")
      return childrenCountById.get(member.id) ?? 0;
    if (sortConfig.key === "date.birth") return member.date.birth || "";
    if (sortConfig.key === "date.death") return member.date.death || "";
    const val = member[sortConfig.key as keyof Member];
    return typeof val === "string" ? val : typeof val === "number" ? val : "";
  };

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      const aVal = getComparable(a);
      const bVal = getComparable(b);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      if (aStr < bStr) return sortConfig.direction === "asc" ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMembers, sortConfig, childrenCountById]);

  const pagedMembers = useMemo(
    () => sortedMembers.slice(page * pageSize, (page + 1) * pageSize),
    [sortedMembers, page, pageSize],
  );

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    return formatLocaleDate(dateString);
  };

  const confirmDelete = () => {
    if (memberToDelete) {
      void removeMember(memberToDelete.id);
      setMemberToDelete(null);
    }
  };

  const handleExportCsv = () => {
    const exportColumns = visibleColumns.filter((id) => id !== "photo");
    const header = exportColumns.map((id) => t(COLUMN_MAP[id].titleKey));
    const rows = sortedMembers.map((m) => {
      const ageResult = computeAge(m);
      return exportColumns.map((id) => {
        switch (id) {
          case "firstName":
            return m.firstName;
          case "lastName":
            return m.lastName;
          case "maidenName":
            return m.maidenName ?? "";
          case "gender":
            return tCommon(`gender.${m.gender}`);
          case "birth":
            return m.date.birth || "";
          case "death":
            return m.date.death ?? "";
          case "birthplace":
            return m.birthplace ?? "";
          case "hometown":
            return m.hometown ?? "";
          case "cemetery":
            return m.cemetery ?? "";
          case "age":
            return ageResult.age !== null ? String(ageResult.age) : "";
          case "childrenCount":
            return String(childrenCountById.get(m.id) ?? 0);
          case "status":
            return isDeceased(m) ? t("status.deceased") : t("status.alive");
          default:
            return "";
        }
      });
    });
    const csv = toCsv([header, ...rows]);
    const workspaceName =
      activeTree?.name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() ?? "members";
    downloadCsv(`${workspaceName}-members.csv`, csv);
  };

  const GenderIcon = (member: Member) => {
    const size = 20;
    switch (member.gender) {
      case "m":
        return <Mars size={size} aria-hidden="true" />;
      case "f":
        return <Venus size={size} aria-hidden="true" />;
      default:
        return <VenusAndMars size={size} aria-hidden="true" />;
    }
  };

  const renderCell = (id: ListColumnId, member: Member) => {
    const ageResult = computeAge(member);
    switch (id) {
      case "photo":
        return (
          <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
            {member.imageData ? (
              <AuthenticatedImage
                src={member.imageData}
                alt={`${member.firstName} ${member.lastName}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[10px] font-medium text-muted-foreground">
                {(member.firstName?.[0] ?? "").toUpperCase()}
                {(member.lastName?.[0] ?? "").toUpperCase()}
              </span>
            )}
          </div>
        );
      case "firstName":
        return <span className="font-medium">{member.firstName}</span>;
      case "lastName":
        return member.lastName;
      case "maidenName":
        return member.maidenName || "-";
      case "gender":
        return (
          <>
            <GenderIcon {...member} />
            <span className="sr-only">
              {tCommon(`gender.${member.gender}`)}
            </span>
          </>
        );
      case "birth":
        return formatDate(member.date.birth);
      case "death":
        return formatDate(member.date.death);
      case "birthplace":
        return member.birthplace || "-";
      case "hometown":
        return member.hometown || "-";
      case "cemetery":
        return member.cemetery || "-";
      case "age":
        if (ageResult.age === null) return "-";
        return (
          <span title={ageResult.atDeath ? t("age-at-death") : undefined}>
            {ageResult.age}
            {ageResult.atDeath ? " †" : ""}
          </span>
        );
      case "childrenCount":
        return childrenCountById.get(member.id) ?? 0;
      case "status":
        return (
          <Badge
            variant={isDeceased(member) ? "secondary" : "outline"}
            className="text-xs font-normal"
          >
            {isDeceased(member) ? t("status.deceased") : t("status.alive")}
          </Badge>
        );
      default:
        return null;
    }
  };

  // +1 for the actions column
  const colCount = visibleColumns.length + 1;

  return (
    <ViewLayout
      title={t("title")}
      contentClassName="md:flex md:min-h-0 md:flex-col md:overflow-hidden"
      action={
        isReady ? (
          <div
            className="text-sm text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {sortedMembers.length}{" "}
            {t("selected-members", { count: sortedMembers.length })}
          </div>
        ) : (
          <Skeleton className="h-4 w-24" />
        )
      }
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 justify-between mb-4 p-1 flex-wrap">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("search-placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <ListFilters filters={filters} onChange={setFilters} />
          <ListCustomizePopover />
          {canInlineEdit && (
            <Button
              variant={inlineEdit ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              aria-pressed={inlineEdit}
              onClick={() => setInlineEdit((v) => !v)}
            >
              <Pencil className="w-3.5 h-3.5" />
              {t("inline-edit.toggle")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleExportCsv}
            disabled={sortedMembers.length === 0}
          >
            <Download className="w-3.5 h-3.5" />
            {t("export-csv")}
          </Button>
        </div>
      </div>

      {/* Inline edit hint */}
      {inlineEditActive && (
        <p className="text-xs text-muted-foreground mb-2 px-1">
          {t("inline-edit.toggle-on-hint")}
        </p>
      )}

      {/* Mobile card layout (unchanged) */}
      <div className="flex flex-col gap-2 md:hidden">
        {!isReady ? (
          Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <div
              key={index}
              className="rounded-md border bg-card p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <div className="flex gap-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
                <Skeleton className="h-9 w-9" />
              </div>
            </div>
          ))
        ) : sortedMembers.length === 0 ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            {t("table.no-members")}
          </div>
        ) : (
          pagedMembers.map((member) => (
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
                    {[member.academicTitle, member.firstName, member.lastName]
                      .filter(Boolean)
                      .join(" ")}
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

      {/* Desktop table */}
      <div className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-md border md:flex">
        <Table containerClassName="flex-1 overflow-auto">
          <caption className="sr-only">{t("table.caption")}</caption>
          <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
            <TableRow className="bg-background">
              {visibleColumns.map((id) => {
                const def = COLUMN_MAP[id];
                if (def.sortable && def.sortKey) {
                  return (
                    <TableHead
                      key={id}
                      aria-sort={
                        sortConfig.key === def.sortKey
                          ? sortConfig.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <Button
                        variant="ghost"
                        onClick={() => handleSort(def.sortKey!)}
                        className="h-8 px-2"
                      >
                        {t(def.titleKey)}
                        <ArrowUpDown />
                      </Button>
                    </TableHead>
                  );
                }
                return <TableHead key={id}>{t(def.titleKey)}</TableHead>;
              })}
              <TableHead className="w-12.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isReady ? (
              Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {Array.from({ length: colCount }).map((_, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton
                        className={
                          cellIndex === colCount - 1
                            ? "h-8 w-8"
                            : "h-4 w-full max-w-28"
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sortedMembers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="h-24 text-center text-muted-foreground"
                >
                  {t("table.no-members")}
                </TableCell>
              </TableRow>
            ) : (
              pagedMembers.map((member) => (
                <TableRow key={member.id}>
                  {visibleColumns.map((id) => (
                    <TableCell
                      key={id}
                      className={
                        inlineEditActive && EDITABLE_COLUMNS.has(id)
                          ? "p-1"
                          : undefined
                      }
                    >
                      {inlineEditActive && EDITABLE_COLUMNS.has(id) ? (
                        <EditableCell member={member} columnId={id} />
                      ) : (
                        renderCell(id, member)
                      )}
                    </TableCell>
                  ))}
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
                          onClick={() => setViewingMember(member)}
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
        {isReady && sortedMembers.length > 0 && (
          <div className="border-t px-2">
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={sortedMembers.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(0);
              }}
            />
          </div>
        )}
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
