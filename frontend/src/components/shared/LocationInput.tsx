import * as React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { GeocodeHint } from "@/components/shared/GeocodeHint";
import { cn } from "@/lib/utils";

interface LocationInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange"
> {
  /** Current location string. */
  value: string | null | undefined;
  /** Called with the new location string on every edit. */
  onChange: (value: string) => void;
  /**
   * Show the geocoding resolution hint. Defaults to true; set false where the
   * map feature is disabled and the hint would be meaningless.
   */
  geocodeEnabled?: boolean;
  /** Content rendered inline after the input, e.g. a remove button. */
  trailing?: React.ReactNode;
  /** className for the resolution hint. */
  hintClassName?: string;
}

// A place-name text field with built-in geocoding: renders the input plus a
// resolution hint (checking / found / not found) so every location field
// behaves the same way without wiring up GeocodeHint by hand (issue #616).
export function LocationInput({
  value,
  onChange,
  geocodeEnabled = true,
  trailing,
  className,
  hintClassName,
  placeholder,
  ...inputProps
}: LocationInputProps) {
  const { t } = useTranslation();

  const input = (
    <Input
      {...inputProps}
      value={value ?? ""}
      placeholder={placeholder ?? t("common.location-input.placeholder")}
      onChange={(e) => onChange(e.target.value)}
      className={cn(trailing && "flex-1", className)}
    />
  );

  return (
    <>
      {trailing ? (
        <div className="flex items-center gap-1">
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
      <GeocodeHint
        location={value}
        enabled={geocodeEnabled}
        className={hintClassName}
      />
    </>
  );
}
