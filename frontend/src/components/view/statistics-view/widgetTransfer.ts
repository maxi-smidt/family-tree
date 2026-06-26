import {
  parseWidgetsExport,
  serializeWidgets,
  type CustomWidget,
  type CustomWidgetConfig,
} from "./customWidgets";

/** Trigger a browser download of the given widgets as a JSON file. */
export function downloadWidgets(widgets: CustomWidget[], filename: string): void {
  const json = serializeWidgets(widgets);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open the native file picker and resolve with the valid widget configs from
 * the chosen JSON file. Resolves to null if the user cancels. Rejects (with a
 * keyed Error) when the file cannot be read or is not a widgets export.
 */
export function pickWidgetsFile(): Promise<CustomWidgetConfig[] | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";

    // Some browsers only fire "cancel" reliably; guard with a flag.
    let settled = false;
    input.addEventListener("cancel", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        if (!settled) {
          settled = true;
          resolve(null);
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        settled = true;
        try {
          resolve(parseWidgetsExport(String(reader.result)));
        } catch (err) {
          reject(err instanceof Error ? err : new Error("invalid-json"));
        }
      };
      reader.onerror = () => {
        settled = true;
        reject(new Error("read-error"));
      };
      reader.readAsText(file);
    });

    input.click();
  });
}
