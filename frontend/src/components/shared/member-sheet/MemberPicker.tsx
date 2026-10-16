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
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { getMemberSearchText, formatMemberSubLabel } from "@/utils/memberUtils";

type Props = {
  members: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  noResultsText: string;
  /** "sm" matches the compact member sheet; "default" matches Input/SelectTrigger (h-9). */
  size?: "sm" | "default";
  /** Classes for the trigger (e.g. a fixed width in a toolbar). */
  className?: string;
  /** Leading icon in the trigger, e.g. a person icon for a filter. */
  icon?: React.ReactNode;
};

export const MemberPicker = ({
  members,
  value,
  onChange,
  placeholder,
  noResultsText,
  size = "sm",
  className,
  icon,
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
            size={size === "default" ? "default" : "sm"}
            className={cn(
              "w-full justify-between font-normal shadow-none",
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {icon}
              <span
                className={cn("truncate", !label && "text-muted-foreground")}
              >
                {label ?? placeholder}
              </span>
            </span>
            <div className="flex items-center gap-1 ml-1 shrink-0">
              {value && (
                <span
                  role="button"
                  aria-label={t("common.clear")}
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
            <CommandInput placeholder={t("common.search-people")} />
            <CommandList className="max-h-64 overflow-y-auto">
              <CommandEmpty className="py-4 text-sm">
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
                    >
                      <MemberAvatar member={m} size="xs" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {m.firstName} {m.lastName}
                        </span>
                        {sublabel && (
                          <span className="truncate text-xs text-muted-foreground">
                            {sublabel}
                          </span>
                        )}
                      </div>
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          value === m.id ? "opacity-100" : "opacity-0",
                        )}
                      />
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
