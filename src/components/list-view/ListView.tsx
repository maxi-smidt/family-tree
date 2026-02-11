import { useFamilyStore } from "@/hooks/useFamilyStore";
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
} from "lucide-react";
import { MemberSheet } from "@/components/sheet/MemberSheet";
import { format } from "date-fns";
import { RemoveNodeDialog } from "@/components/dialog/RemoveNodeDialog";

type SortConfig = {
  key: keyof Member | "date.birth" | "date.death";
  direction: "asc" | "desc";
};

export const ListView = () => {
  const { members, removeMember } = useFamilyStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "firstName",
    direction: "asc",
  });
  const [editingMember, setEditingMember] = useState<Member | null>(null);
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

  const sortedMembers = useMemo(() => {
    const sorted = [...filteredMembers];
    sorted.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (sortConfig.key === "date.birth") {
        aValue = a.date.birth || "";
        bValue = b.date.birth || "";
      } else if (sortConfig.key === "date.death") {
        aValue = a.date.death || "";
        bValue = b.date.death || "";
      } else {
        aValue = a[sortConfig.key as keyof Member];
        bValue = b[sortConfig.key as keyof Member];
      }

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
    return format(new Date(dateString), "dd.MM.yyyy");
  };

  const confirmDelete = () => {
    if (memberToDelete) {
      void removeMember(memberToDelete.id);
      setMemberToDelete(null);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {sortedMembers.length} members found
        </div>
      </div>

      <div className="rounded-md border flex-1 overflow-hidden flex flex-col">
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
                    First Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("lastName")}
                    className="h-8 px-2"
                  >
                    Last Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Maiden Name</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("date.birth")}
                    className="h-8 px-2"
                  >
                    Birth Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("date.death")}
                    className="h-8 px-2"
                  >
                    Death Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-12.5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No members found.
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
                      {member.gender}
                    </TableCell>
                    <TableCell>{formatDate(member.date.birth)}</TableCell>
                    <TableCell>{formatDate(member.date.death)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingMember(member);
                              setIsEditMode(false);
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingMember(member);
                              setIsEditMode(true);
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit Member
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setMemberToDelete(member)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Member
                          </DropdownMenuItem>
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
      />

      <RemoveNodeDialog
        isOpen={!!memberToDelete}
        members={memberToDelete ? [memberToDelete] : []}
        onConfirm={confirmDelete}
        onCancel={() => setMemberToDelete(null)}
      />
    </div>
  );
};
