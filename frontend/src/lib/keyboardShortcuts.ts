export type KeyboardShortcut = "save" | "new-person" | "zoom-in" | "zoom-out";
export const NEW_PERSON_EVENT = "family-tree:new-person";

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutLabel(shortcut: KeyboardShortcut): string {
  if (shortcut === "new-person") return isMac ? "⌘↵" : "Ctrl+Enter";
  if (shortcut === "zoom-in") return "+";
  if (shortcut === "zoom-out") return "−";
  return `${isMac ? "⌘" : "Ctrl+"}S`;
}

export function shortcutAria(shortcut: KeyboardShortcut): string {
  if (shortcut === "new-person") return `${isMac ? "Meta" : "Control"}+Enter`;
  if (shortcut === "zoom-in") return "+";
  if (shortcut === "zoom-out") return "-";
  return `${isMac ? "Meta" : "Control"}+S`;
}

export function isAvailable(element: Element): boolean {
  return !element.closest(
    '[hidden], [inert], [aria-hidden="true"], [data-state="closed"], [role="tabpanel"][data-state="inactive"]',
  );
}

export function activeDialog(): HTMLElement | undefined {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"]',
    ),
  ].filter(isAvailable);
  return dialogs[dialogs.length - 1];
}

export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.isContentEditable ||
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menu"], [role="listbox"], [role="tablist"], [role="tree"], [role="radiogroup"]',
      ),
    )
  );
}

/** Save only within the foreground dialog, or the focused area of the page. */
export function saveActivePanel(target: EventTarget | null): void {
  const scope = activeDialog() ?? document.body;
  const selector = 'button[data-shortcut="save"], form[data-save-shortcut]';
  const candidates = [...scope.querySelectorAll<HTMLElement>(selector)].filter(
    isAvailable,
  );
  // A submit button and its form represent the same action.
  const actions = candidates.filter(
    (element) =>
      !(element instanceof HTMLFormElement) ||
      !candidates.some(
        (candidate) =>
          candidate instanceof HTMLButtonElement && candidate.form === element,
      ),
  );
  let action: HTMLElement | undefined;
  let focused =
    target instanceof HTMLElement && scope.contains(target) ? target : null;
  while (focused) {
    const nearby = actions.filter((candidate) => focused!.contains(candidate));
    if (nearby.length === 1) {
      action = nearby[0];
      break;
    }
    if (focused === scope) break;
    focused = focused.parentElement;
  }
  action ??= actions.length === 1 ? actions[0] : undefined;
  if (action instanceof HTMLButtonElement) action.click();
  else if (action instanceof HTMLFormElement) action.requestSubmit();
}
