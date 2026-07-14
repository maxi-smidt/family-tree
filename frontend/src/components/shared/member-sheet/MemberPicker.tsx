import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { getMemberSearchText, formatMemberSubLabel } from "@/utils/memberUtils";

type Props = {
  members: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  noResultsText: string;
  /** "sm" matches the compact member sheet; "default" matches Input/SelectTrigger (h-9). */
  size?: "sm" | "default";
};

export const MemberPicker = ({
  members,
  value,
  onChange,
  placeholder,
  noResultsText,
  size = "sm",
}: Props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const triggerContainerRef = useRef<HTMLDivElement>(null);

  const selected = members.find((m) => m.id === value) ?? null;
  const label = selected ? `${selected.firstName} ${selected.lastName}` : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      // Portal into the containing sheet/dialog so its scroll lock doesn't
      // swallow wheel events over the list (body-portaled content is outside
      // the lock's allowed subtree and becomes wheel-inert).
      setPortalContainer(
        triggerContainerRef.current?.closest<HTMLElement>(
          '[data-slot="sheet-content"], [data-slot="dialog-content"]',
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
            className={cn(
              "w-full justify-between shadow-none font-normal",
              size === "default" ? "h-9 text-sm" : "h-7 text-xs",
            )}
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
                  const sublabel = formatMemberSubLabel(
                    m.maidenName,
                    m.date.birth,
                    (name) => t("common.nee", { name }),
                  );
                  return (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      keywords={[getMemberSearchText(m)]}
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
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">
                          {m.firstName} {m.lastName}
                        </span>
                        {sublabel && (
                          <span className="truncate text-muted-foreground">
                            {sublabel}
                          </span>
                        )}
                      </div>
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
