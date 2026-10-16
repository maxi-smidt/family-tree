import { useMemberStore } from "@/hooks/useMemberStore";
import { useState, useMemo, useEffect } from "react";
import { Member, isDeceased } from "@/types/member";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortButton,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { SearchInput } from "@/components/shared/SearchInput";
import { usePendingMember } from "@/hooks/usePendingMember";
import { createMember } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { EditableCell } from "./EditableCell";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
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
    key: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(0);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [inlineEdit, setInlineEdit] = useState(false);
  const pending = usePendingMember({ onHorizontalRelationReady: () => {} });

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

  const statusCounts = useMemo(() => {
    const deceased = members.filter((m) => isDeceased(m)).length;
    return {
      all: members.length,
      alive: members.length - deceased,
      deceased,
    };
  }, [members]);

  // Lifespan bars share one axis: from the half-century before the earliest
  // birth to today.
  const lifespanAxis = useMemo(() => {
    const years = members
      .map((m) => getYear(m.date.birth))
      .filter((y): y is number => y !== null);
    const end = new Date().getFullYear();
    const start = years.length
      ? Math.floor(Math.min(...years) / 50) * 50
      : 1900;
    return { start, end, span: Math.max(1, end - start) };
  }, [members]);

  const handleAddPerson = () => {
    const rightmost = members.reduce(
      (max, m) => Math.max(max, m.position.x),
      -NODE_WIDTH,
    );
    pending.createNew(createMember({ x: rightmost + NODE_WIDTH + 60, y: 0 }));
  };

  const getComparable = (member: Member): string | number => {
    if (sortConfig.key === "name")
      return `${member.lastName} ${member.firstName}`.toLocaleLowerCase();
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
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortConfig.direction === "asc" ? cmp : -cmp;
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
    if (!dateString) return "—";
    return formatLocaleDate(dateString) || dateString;
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
          case "name":
            return [m.academicTitle, m.firstName, m.lastName]
              .filter(Boolean)
              .join(" ");
          case "lifespan":
            return ageResult.age !== null ? String(ageResult.age) : "";
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

  const renderCell = (id: ListColumnId, member: Member) => {
    const ageResult = computeAge(member);
    switch (id) {
      case "name": {
        const fullName = [
          member.academicTitle,
          member.firstName,
          member.lastName,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span className="flex items-center gap-3">
            {!visibleColumns.includes("photo") && (
              <MemberAvatar member={member} size="sm" />
            )}
            <span className="flex min-w-0 flex-col">
              <button
                type="button"
                className="truncate text-left font-semibold hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() => setViewingMember(member)}
              >
                {fullName}
              </button>
              <span className="truncate text-xs text-muted-foreground">
                {member.maidenName
                  ? tCommon("nee", { name: member.maidenName })
                  : isDeceased(member)
                    ? t("status.deceased")
                    : t("status.alive")}
              </span>
            </span>
          </span>
        );
      }
      case "lifespan": {
        const birthYear = getYear(member.date.birth);
        if (birthYear === null || ageResult.age === null) {
          return <span className="text-muted-foreground">—</span>;
        }
        const { start, span, end } = lifespanAxis;
        const endYear = getYear(member.date.death) ?? end;
        const left = ((birthYear - start) / span) * 100;
        const width = Math.max(1, ((endYear - birthYear) / span) * 100);
        return (
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="relative h-1.5 w-32 shrink-0 rounded-full bg-muted"
            >
              <span
                className={`absolute inset-y-0 rounded-full ${
                  ageResult.atDeath ? "bg-edge" : "bg-primary"
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
            <span
              className="text-[12.5px] text-muted-foreground tabular-nums"
              title={ageResult.atDeath ? t("age-at-death") : undefined}
            >
              {ageResult.atDeath
                ? t("lifespan-died", { count: ageResult.age })
                : t("lifespan-age", { count: ageResult.age })}
            </span>
          </span>
        );
      }
      case "photo":
        return <MemberAvatar member={member} size="sm" />;
      case "firstName":
        return visibleColumns.includes("photo") ? (
          <span className="font-semibold">{member.firstName}</span>
        ) : (
          <span className="flex items-center gap-3">
            <MemberAvatar member={member} size="sm" />
            <span className="font-semibold">{member.firstName}</span>
          </span>
        );
      case "lastName":
        return member.lastName;
      case "maidenName":
        return member.maidenName || "—";
      case "gender":
        return (
          <span className="inline-flex items-center gap-2 text-muted-foreground capitalize">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                member.gender === "m"
                  ? "bg-gender-m"
                  : member.gender === "f"
                    ? "bg-gender-f"
                    : "bg-gender-o"
              }`}
            />
            {tCommon(`gender.${member.gender}`)}
          </span>
        );
      case "birth":
        return formatDate(member.date.birth);
      case "death":
        return formatDate(member.date.death);
      case "birthplace":
        return member.birthplace || "—";
      case "hometown":
        return member.hometown || "—";
      case "cemetery":
        return member.cemetery || "—";
      case "age":
        if (ageResult.age === null) return "—";
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

  const openEditor = (member: Member) => {
    setEditingMember(member);
    setIsEditMode(true);
  };

  const rowActions = (member: Member) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <span className="sr-only">{t("menu.trigger")}</span>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("menu.actions")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setViewingMember(member)}>
          <Eye />
          {t("menu.details")}
        </DropdownMenuItem>
        {canWrite && (
          <>
            <DropdownMenuItem onClick={() => openEditor(member)}>
              <Pencil />
              {t("menu.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setMemberToDelete(member)}
            >
              <Trash2 />
              {t("menu.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ViewLayout
      title={t("title")}
      subtitle={
        isReady ? (
          <span aria-live="polite" aria-atomic="true">
            {t("subtitle", {
              count: statusCounts.all,
              living: statusCounts.alive,
            })}
          </span>
        ) : (
          <Skeleton className="h-4 w-32" />
        )
      }
      contentClassName="md:flex md:min-h-0 md:flex-col md:overflow-hidden"
      action={
        <>
          <Button
            variant="outline"
            onClick={handleExportCsv}
            disabled={sortedMembers.length === 0}
          >
            <Download />
            {t("export-csv")}
          </Button>
          {canWrite && (
            <Button onClick={handleAddPerson}>
              <Plus />
              {t("add-person")}
            </Button>
          )}
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="chip"
            size="sm"
            spacing={2}
            value={filters.status}
            onValueChange={(v) =>
              v &&
              setFilters({
                ...filters,
                status: v as ListFilterState["status"],
              })
            }
            aria-label={t("filter-status")}
          >
            {(["all", "alive", "deceased"] as const).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {t(`chip.${key}`)}
                <span className="tabular-nums opacity-60">
                  {statusCounts[key]}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator
            orientation="vertical"
            className="mx-1 hidden data-[orientation=vertical]:h-5 sm:block"
          />
          <SearchInput
            size="sm"
            containerClassName="w-full sm:w-60"
            placeholder={t("search-placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
          />
          <ListFilters filters={filters} onChange={setFilters} />
          <div className="hidden flex-1 sm:block" />
          <ListCustomizePopover />
          {canInlineEdit && (
            <Button
              variant={inlineEdit ? "default" : "outline"}
              size="sm"
              aria-pressed={inlineEdit}
              onClick={() => setInlineEdit((v) => !v)}
            >
              <Pencil />
              {t("inline-edit.toggle")}
            </Button>
          )}
        </div>
      }
    >
      {inlineEditActive && (
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          {t("inline-edit.toggle-on-hint")}
        </p>
      )}

      {/* Phone: one card, a row per person */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs md:hidden">
        {!isReady ? (
          Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))
        ) : sortedMembers.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t("table.no-members")}
          </div>
        ) : (
          <ul className="divide-y">
            {pagedMembers.map((member) => (
              <li key={member.id} className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setViewingMember(member)}
                >
                  <MemberAvatar member={member} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {[member.academicTitle, member.firstName, member.lastName]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        formatDate(member.date.birth),
                        member.date.death
                          ? `† ${formatDate(member.date.death)}`
                          : null,
                        member.birthplace,
                      ]
                        .filter((x) => x && x !== "—")
                        .join(" · ")}
                    </span>
                  </span>
                </button>
                {rowActions(member)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-xs md:flex">
        <Table containerClassName="flex-1 overflow-auto">
          <caption className="sr-only">{t("table.caption")}</caption>
          <TableHeader className="sticky top-0 z-20 bg-card">
            <TableRow className="hover:bg-transparent">
              {visibleColumns.map((id) => {
                const def = COLUMN_MAP[id];
                if (def.sortable && def.sortKey) {
                  const active = sortConfig.key === def.sortKey;
                  return (
                    <TableHead
                      key={id}
                      aria-sort={
                        active
                          ? sortConfig.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <TableSortButton
                        active={active}
                        direction={sortConfig.direction}
                        onClick={() => handleSort(def.sortKey!)}
                      >
                        {t(def.titleKey)}
                      </TableSortButton>
                    </TableHead>
                  );
                }
                return <TableHead key={id}>{t(def.titleKey)}</TableHead>;
              })}
              <TableHead className="w-14">
                <span className="sr-only">{t("menu.actions")}</span>
              </TableHead>
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
                            ? "size-8"
                            : "h-4 w-full max-w-28"
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sortedMembers.length === 0 ? (
              <TableRow className="hover:bg-transparent">
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
                  {visibleColumns.map((id) => {
                    const editable =
                      inlineEditActive &&
                      (EDITABLE_COLUMNS.has(id) || id === "name");
                    return (
                      <TableCell
                        key={id}
                        className={
                          editable
                            ? "py-1"
                            : id === "birth"
                              ? "tabular-nums"
                              : id === "death"
                                ? "text-muted-foreground tabular-nums"
                                : id === "hometown"
                                  ? "text-muted-foreground"
                                  : undefined
                        }
                      >
                        {editable && id === "name" ? (
                          <div className="flex gap-1">
                            <EditableCell
                              member={member}
                              columnId="firstName"
                            />
                            <EditableCell member={member} columnId="lastName" />
                          </div>
                        ) : editable ? (
                          <EditableCell member={member} columnId={id} />
                        ) : (
                          renderCell(id, member)
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right">
                    {rowActions(member)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {isReady && sortedMembers.length > 0 && (
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
      )}

      <MemberSheet
        isOpen={!!editingMember}
        onClose={() => setEditingMember(null)}
        member={editingMember}
        initialEditMode={isEditMode}
        canEdit={canWrite}
      />

      <MemberSheet
        isOpen={!!pending.editingMember}
        onClose={pending.closeSheet}
        member={pending.editingMember}
        initialEditMode
        canEdit={canWrite}
        isNewMember={pending.isNewMemberSession}
        onDiscardNewMember={pending.discardNewMember}
        onSaveNewMember={pending.saveNewMember}
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
