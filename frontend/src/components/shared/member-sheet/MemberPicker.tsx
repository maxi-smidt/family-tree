import { useRef, useState } from "react";
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
import { formatDate } from "@/utils/dateUtils";

type Props = {
  members: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  noResultsText: string;
  /** Show each member's birth date next to their name for easier identification. */
  showBirthDate?: boolean;
};

export const MemberPicker = ({
  members,
  value,
  onChange,
  placeholder,
  noResultsText,
  showBirthDate = false,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const triggerContainerRef = useRef<HTMLDivElement>(null);

  const selected = members.find((m) => m.id === value) ?? null;
  const label = selected ? `${selected.firstName} ${selected.lastName}` : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPortalContainer(
        triggerContainerRef.current?.closest<HTMLElement>(
          '[data-slot="sheet-content"]',
        ) ?? undefined,
      );
    }

    setOpen(nextOpen);
  };

  return (
    <div ref={triggerContainerRef}>
      <Popover open={open} onOpenChange={handleOpenChange}>
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
        <PopoverContent
          className="w-64 p-0"
          align="start"
          portalContainer={portalContainer}
        >
          <Command>
            <CommandInput className="h-8 text-xs" placeholder={placeholder} />
            <CommandList className="max-h-48 overflow-y-auto">
              <CommandEmpty className="text-xs py-4">
                {noResultsText}
              </CommandEmpty>
              <CommandGroup>
                {members.map((m) => {
                  const birthDate = showBirthDate
                    ? formatDate(m.date.birth)
                    : "";
                  return (
                    <CommandItem
                      key={m.id}
                      value={`${m.firstName} ${m.lastName} ${m.date.birth} ${m.id}`}
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
                      <span className="truncate">
                        {m.firstName} {m.lastName}
                      </span>
                      {birthDate && (
                        <span className="ml-auto pl-2 shrink-0 text-muted-foreground tabular-nums">
                          {birthDate}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
