import * as React from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  /** Classes for the wrapper (width, flex). `className` styles the input. */
  containerClassName?: string;
  /** When given, a clear button appears while the field has a value. */
  onClear?: () => void;
};

/**
 * The one search field used across views and dialogs: leading search icon,
 * optional clear button, and the shared control sizes from Input.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ containerClassName, className, onClear, value, size, ...props }, ref) => {
    const { t } = useTranslation();
    const hasValue = value !== undefined && value !== null && value !== "";
    return (
      <div className={cn("relative", containerClassName)}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={ref}
          type="search"
          value={value}
          size={size}
          className={cn(
            "pl-8 [&::-webkit-search-cancel-button]:hidden",
            onClear && "pr-8",
            className,
          )}
          {...props}
        />
        {onClear && hasValue && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t("common.clear-search")}
            className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
