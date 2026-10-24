import { ExternalLink, Link as LinkIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { externalLinkHref } from "@/utils/externalLink";

interface Props {
  url: string;
  label: string;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  isNew?: boolean;
  disabled?: boolean;
}

/** Match file attachment rows, keeping the editable label visibly an input. */
export function DocumentLinkAttachment({
  url,
  label,
  onLabelChange,
  onRemove,
  isNew = false,
  disabled = false,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.dialog.files",
  });
  const href = externalLinkHref(url);

  return (
    <div className="flex items-start gap-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded border">
        <LinkIcon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder={t("link-label-placeholder")}
          aria-label={t("link-label-placeholder")}
          disabled={disabled}
          className="h-8"
        />
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-fit max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline underline-offset-2"
          title={url}
        >
          <span className="truncate">{url}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      </div>
      {isNew && (
        <span className="pt-2 text-xs text-muted-foreground">{t("new")}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t("remove")}
        aria-label={t("remove")}
        disabled={disabled}
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}
