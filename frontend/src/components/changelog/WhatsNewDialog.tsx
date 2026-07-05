import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { compareVersions } from "@/utils/version";
import { APP_VERSION } from "@/lib/buildInfo";
import changelogData from "@/data/changelog.json";

interface ChangelogEntry {
  version: string;
  date: string;
  body: string;
}

const entries = changelogData as ChangelogEntry[];

/** Non-parseable/dev builds show every entry instead of filtering by version. */
const NON_VERSIONS = new Set(["dev", "unknown", ""]);

function isParseableVersion(v: string): boolean {
  if (NON_VERSIONS.has(v)) return false;
  const stripped = v.replace(/^v/, "").trim();
  if (NON_VERSIONS.has(stripped)) return false;
  return stripped
    .split(".")
    .every((part) => part !== "" && Number.isInteger(Number(part)));
}

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "changelog" });

  const visibleEntries = isParseableVersion(APP_VERSION)
    ? entries.filter(
        (entry) => compareVersions(entry.version, APP_VERSION) <= 0,
      )
    : entries;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto max-h-[70vh] space-y-4">
          {visibleEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
          {visibleEntries.map((entry, index) => (
            <div key={entry.version}>
              {index > 0 && <Separator className="mb-4" />}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold text-sm">{entry.version}</span>
                {entry.date && (
                  <span className="text-xs text-muted-foreground">
                    {entry.date}
                  </span>
                )}
              </div>
              <MarkdownContent content={entry.body} />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
