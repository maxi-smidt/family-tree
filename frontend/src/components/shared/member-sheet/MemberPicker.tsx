import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Member } from "@/types/member";

type Props = {
  members: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  noResultsText: string;
};

export const MemberPicker = ({
  members,
  value,
  onChange,
  placeholder,
  noResultsText,
}: Props) => {
  const [open, setOpen] = useState(false);

  const selected = members.find((m) => m.id === value) ?? null;
  const label = selected ? `${selected.firstName} ${selected.lastName}` : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-7 w-full justify-between text-xs shadow-none font-normal"
        >
          <span className={cn(!label && "text-muted-foreground truncate")}>
            {label ?? placeholder}
          </span>
          <div className="flex items-center gap-1 ml-1 shrink-0">
            {value && (
              <span
                role="button"
                aria-label="Clear"
                className="opacity-60 hover:opacity-100"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(null);
                }}
              >
                <X className="size-3" />
              </span>
            )}
            <ChevronDown className="size-3 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput className="h-8 text-xs" placeholder={placeholder} />
          <CommandList className="max-h-48 overflow-y-auto">
            <CommandEmpty className="text-xs py-4">
              {noResultsText}
            </CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.firstName} ${m.lastName} ${m.id}`}
                  onSelect={() => {
                    onChange(m.id === value ? null : m.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "size-3 shrink-0",
                      value === m.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {m.firstName} {m.lastName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
