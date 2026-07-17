import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
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
const PAGE_SIZE = 10;

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

export function ChangelogList() {
  const { t } = useTranslation(undefined, { keyPrefix: "changelog" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleEntries = isParseableVersion(APP_VERSION)
    ? entries.filter(
        (entry) => compareVersions(entry.version, APP_VERSION) <= 0,
      )
    : entries;
  const renderedEntries = visibleEntries.slice(0, visibleCount);

  return (
    <>
      {visibleEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {renderedEntries.map((entry, index) => (
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
      {renderedEntries.length < visibleEntries.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          {t("load-more")}
        </Button>
      )}
    </>
  );
}
