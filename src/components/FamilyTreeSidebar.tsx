import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EdgeType, useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";

export function FamilyTreeSidebar() {
  const { edgeType, setEdgeType } = useFamilyTreeSettings();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="flex flex-col gap-1.5 w-full p-1">
                  <label className="text-xs font-medium text-muted-foreground ml-1">
                    Edge Type
                  </label>
                  <Select
                    value={edgeType}
                    onValueChange={(val) => setEdgeType(val as EdgeType)}
                  >
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="straight">Straight</SelectItem>
                      <SelectItem value="step">Step</SelectItem>
                      <SelectItem value="smoothstep">Smoothstep</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
