import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Props = {
  className?: string;
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
};

export const DatePicker = ({
  className,
  value,
  onChange,
  placeholder = "Pick a date",
}: Props) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-between px-2 py-0 font-normal text-left",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {value ? format(value, "dd.MM.yyyy") : placeholder}
          </span>
          <ChevronDownIcon className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          captionLayout="dropdown"
          onSelect={(newDate) => {
            onChange?.(newDate);
            setOpen(false);
          }}
          startMonth={new Date(1500, 0)}
          endMonth={new Date()}
        />
      </PopoverContent>
    </Popover>
  );
};
