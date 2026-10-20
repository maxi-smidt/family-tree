import { cn } from "@/lib/utils";
import { shortcutLabel, type KeyboardShortcut } from "@/lib/keyboardShortcuts";

export function ShortcutHint({
  shortcut,
  className,
}: {
  shortcut: KeyboardShortcut;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "ml-1 rounded border border-current/20 px-1.5 py-0.5 font-sans text-[11px] leading-none opacity-70 max-md:hidden",
        className,
      )}
    >
      {shortcutLabel(shortcut)}
    </kbd>
  );
}
