import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { useLegalStore } from "@/hooks/useLegalStore";
import {
  LEGAL_DEFAULT_LOCALE,
  LEGAL_LOCALES,
  LegalLocale,
} from "@/lib/legalLocale";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether to include the Terms of Service tab. Pre-login surfaces (login
   * page, public tree viewer) set this to false: the Terms are not legally
   * required before sign-in and are covered by the post-login acceptance gate,
   * whereas the Privacy Policy and Impressum must stay publicly reachable.
   */
  showTerms?: boolean;
}

/**
 * Read-only Terms / Privacy / Impressum viewer, reachable pre-login (footer
 * links) and on the public tree viewer. Fetches from the unauthenticated
 * `GET /legal/public` endpoint via `useLegalStore`.
 */
export function LegalDocsDialog({
  open,
  onOpenChange,
  showTerms = true,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: "legal" });
  const documents = useLegalStore((s) => s.documents);
  const loaded = useLegalStore((s) => s.loaded);
  const load = useLegalStore((s) => s.load);

  const [viewLocale, setViewLocale] =
    useState<LegalLocale>(LEGAL_DEFAULT_LOCALE);

  useEffect(() => {
    if (open) void load(viewLocale);
  }, [open, load, viewLocale]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("docs-dialog-title")}</DialogTitle>
        </DialogHeader>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t("language-label")}
        >
          {LEGAL_LOCALES.map((loc) => (
            <Button
              key={loc}
              type="button"
              size="sm"
              variant={viewLocale === loc ? "default" : "outline"}
              onClick={() => setViewLocale(loc)}
            >
              {t(`lang-${loc}`)}
            </Button>
          ))}
        </div>
        {!loaded ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <Spinner className="size-6" />
          </div>
        ) : (
          <Tabs
            defaultValue={showTerms ? "terms" : "privacy"}
            className="flex-1 min-h-0"
          >
            <TabsList>
              {showTerms && (
                <TabsTrigger value="terms">{t("tab-terms")}</TabsTrigger>
              )}
              <TabsTrigger value="privacy">{t("tab-privacy")}</TabsTrigger>
              <TabsTrigger value="imprint">{t("tab-imprint")}</TabsTrigger>
            </TabsList>
            {showTerms && (
              <TabsContent
                value="terms"
                className="overflow-y-auto max-h-[55vh]"
              >
                <MarkdownContent content={documents?.terms_body ?? ""} />
              </TabsContent>
            )}
            <TabsContent
              value="privacy"
              className="overflow-y-auto max-h-[55vh]"
            >
              <MarkdownContent content={documents?.privacy_body ?? ""} />
            </TabsContent>
            <TabsContent
              value="imprint"
              className="overflow-y-auto max-h-[55vh]"
            >
              <MarkdownContent content={documents?.imprint_body ?? ""} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
