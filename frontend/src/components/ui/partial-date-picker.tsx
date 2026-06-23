import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  DatePrecision,
  formatPartialDateForInput,
  getDatePrecision,
  parsePartialDateInput,
  resolveDateLocale,
} from "@/utils/dateUtils";
import { useTranslation } from "react-i18next";

type Props = {
  className?: string;
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
};

const YEAR_MIN = 1400;
const YEAR_MAX = new Date().getFullYear();

function getMonthNames(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: "short" }).format(
      new Date(2000, i, 1),
    ),
  );
}

function parseParts(value: string | null | undefined): {
  year: number | null;
  month: number | null;
  day: number | null;
} {
  if (!value) return { year: null, month: null, day: null };
  const parts = value.split("-").map(Number);
  return {
    year: parts[0] ?? null,
    month: parts[1] ?? null,
    day: parts[2] ?? null,
  };
}

export const PartialDatePicker = ({
  className,
  value,
  onChange,
  placeholder,
}: Props) => {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const locale = resolveDateLocale(language);
  const monthNames = getMonthNames(locale);
  const today = new Date();

  // Editable text representation of the value, kept in sync while not focused.
  const inputText = formatPartialDateForInput(value, language);
  const [text, setText] = useState(inputText);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(inputText);
  }, [inputText, focused]);

  const textIsInvalid =
    focused &&
    text.trim() !== "" &&
    !parsePartialDateInput(text, language).valid;

  const handleTextChange = (next: string) => {
    setText(next);
    if (next.trim() === "") {
      onChange?.(null);
      return;
    }
    const parsed = parsePartialDateInput(next, language);
    if (parsed.valid && parsed.value) onChange?.(parsed.value);
  };

  const handleTextBlur = () => {
    setFocused(false);
    if (text.trim() === "") {
      setText("");
      return;
    }
    const parsed = parsePartialDateInput(text, language);
    setText(
      parsed.valid && parsed.value
        ? formatPartialDateForInput(parsed.value, language)
        : inputText,
    );
  };

  const inferredPrecision: DatePrecision =
    getDatePrecision(value ?? null) ?? "day";
  const [open, setOpen] = useState(false);
  const [activePrecision, setActivePrecision] =
    useState<DatePrecision>(inferredPrecision);

  // viewYear drives decade navigation in Year mode and month grid in Month mode.
  const { year: parsedYear, month: parsedMonth } = parseParts(value);
  const [viewYear, setViewYear] = useState(parsedYear ?? YEAR_MAX);

  // Sync view when value changes externally (e.g. form reset).
  useEffect(() => {
    if (parsedYear) setViewYear(parsedYear);
  }, [parsedYear]);

  // When popover opens, sync activePrecision to the current value's precision.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setActivePrecision(getDatePrecision(value ?? null) ?? "day");
      if (!value) setViewYear(today.getFullYear());
    }
    setOpen(next);
  };

  const switchPrecision = (p: DatePrecision) => {
    setActivePrecision(p);
    // Trim value to the new precision on the fly so the display updates.
    if (!value) return;
    if (p === "year" && parsedYear) {
      onChange?.(`${parsedYear}`);
    } else if (p === "month" && parsedYear) {
      const m = parsedMonth ?? 1;
      onChange?.(`${parsedYear}-${String(m).padStart(2, "0")}`);
    }
    // "day" — keep full date as-is (or let user pick via calendar)
  };

  const handleYearSelect = (y: number) => {
    onChange?.(`${y}`);
    setOpen(false);
  };

  const handleMonthSelect = (m: number) => {
    onChange?.(`${viewYear}-${String(m).padStart(2, "0")}`);
    setOpen(false);
  };

  const handleDaySelect = (date: Date | undefined) => {
    if (!date) {
      onChange?.(null);
    } else {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      onChange?.(`${y}-${m}-${d}`);
    }
    setOpen(false);
  };

  const clearValue = () => {
    onChange?.(null);
    setOpen(false);
  };

  // ── Decade grid for Year mode ───────────────────────────────────────────────
  const decadeStart = Math.floor(viewYear / 10) * 10;
  const decadeYears = Array.from({ length: 12 }, (_, i) => decadeStart - 1 + i);

  // ── Derived Calendar value ──────────────────────────────────────────────────
  const calendarValue =
    parsedYear && parsedMonth && parseParts(value).day
      ? new Date(parsedYear, parsedMonth - 1, parseParts(value).day!)
      : undefined;

  const PRECISION_LABELS: Record<NonNullable<DatePrecision>, string> = {
    year: "Y",
    month: "M",
    day: "D",
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={handleTextBlur}
            placeholder={t("common.date-input-hint")}
            aria-label={placeholder ?? t("common.date-input-hint")}
            aria-invalid={textIsInvalid}
            className={cn("pr-12", className)}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {value && (
              <button
                type="button"
                aria-label={t("common.clear-date")}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={clearValue}
              >
                <XIcon className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("common.open-date-picker")}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Precision tabs */}
        <div className="flex border-b">
          {(["year", "month", "day"] as NonNullable<DatePrecision>[]).map(
            (p) => (
              <button
                key={p}
                type="button"
                onClick={() => switchPrecision(p)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium transition-colors",
                  activePrecision === p
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PRECISION_LABELS[p]}
              </button>
            ),
          )}
        </div>

        {/* Year picker */}
        {activePrecision === "year" && (
          <div className="p-2 w-[224px]">
            <div className="flex items-center justify-between mb-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                type="button"
                onClick={() => setViewYear((y) => Math.max(y - 10, YEAR_MIN))}
                disabled={decadeStart <= YEAR_MIN}
              >
                <ChevronLeftIcon className="h-3 w-3" />
              </Button>
              <span className="text-xs font-medium">
                {decadeStart} – {Math.min(decadeStart + 9, YEAR_MAX)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                type="button"
                onClick={() => setViewYear((y) => Math.min(y + 10, YEAR_MAX))}
                disabled={decadeStart + 10 > YEAR_MAX}
              >
                <ChevronRightIcon className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {decadeYears.map((y) => {
                const outOfRange = y < YEAR_MIN || y > YEAR_MAX;
                return (
                  <button
                    key={y}
                    type="button"
                    disabled={outOfRange}
                    onClick={() => !outOfRange && handleYearSelect(y)}
                    className={cn(
                      "rounded px-1 py-1.5 text-xs transition-colors",
                      outOfRange && "opacity-25 cursor-default",
                      parsedYear === y
                        ? "bg-primary text-primary-foreground font-semibold"
                        : !outOfRange && "hover:bg-accent",
                    )}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Month picker */}
        {activePrecision === "month" && (
          <div className="p-2 w-[224px]">
            <div className="flex items-center justify-between mb-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                type="button"
                onClick={() => setViewYear((y) => Math.max(y - 1, YEAR_MIN))}
                disabled={viewYear <= YEAR_MIN}
              >
                <ChevronLeftIcon className="h-3 w-3" />
              </Button>
              <span className="text-xs font-medium">{viewYear}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                type="button"
                onClick={() => setViewYear((y) => Math.min(y + 1, YEAR_MAX))}
                disabled={viewYear >= YEAR_MAX}
              >
                <ChevronRightIcon className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {monthNames.map((name, idx) => {
                const m = idx + 1;
                const isSelected = parsedYear === viewYear && parsedMonth === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleMonthSelect(m)}
                    className={cn(
                      "rounded px-1 py-1.5 text-xs transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-accent",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Day picker — full calendar */}
        {activePrecision === "day" && (
          <Calendar
            mode="single"
            selected={calendarValue}
            captionLayout="dropdown"
            onSelect={handleDaySelect}
            startMonth={new Date(YEAR_MIN, 0)}
            endMonth={new Date(YEAR_MAX, 11)}
            defaultMonth={
              calendarValue ??
              (parsedYear ? new Date(viewYear, (parsedMonth ?? 1) - 1) : today)
            }
          />
        )}
      </PopoverContent>
    </Popover>
  );
};
