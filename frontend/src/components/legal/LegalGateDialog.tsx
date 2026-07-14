import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useLegalStore } from "@/hooks/useLegalStore";
import {
  LEGAL_DEFAULT_LOCALE,
  LEGAL_LOCALES,
  LegalLocale,
} from "@/lib/legalLocale";

/**
 * Blocking, non-dismissable gate shown after login until the user accepts
 * the current Terms of Service + Privacy Policy. There is no close button,
 * and ESC / overlay-click / programmatic close are all suppressed — the only
 * way out is clicking Accept once the checkbox is ticked. Takes priority over
 * the What's New/tutorial dialogs (mounted before them in `Layout`).
 */
export function LegalGateDialog() {
  const { t } = useTranslation(undefined, { keyPrefix: "legal" });
  const user = useAuthStore((s) => s.user);
  const documents = useLegalStore((s) => s.documents);
  const loaded = useLegalStore((s) => s.loaded);
  const load = useLegalStore((s) => s.load);
  const accept = useLegalStore((s) => s.accept);
  const accepting = useLegalStore((s) => s.accepting);

  const [checked, setChecked] = useState(false);

  // The locale the user reads/accepts in: German by default, switchable via the
  // in-dialog toggle. The accepted locale is recorded in the audit row.
  const [viewLocale, setViewLocale] =
    useState<LegalLocale>(LEGAL_DEFAULT_LOCALE);

  const open =
    !!user && !!user.legal_acceptance_required && !user.legal_accepted;

  useEffect(() => {
    if (open) void load(viewLocale);
  }, [open, load, viewLocale]);

  useEffect(() => {
    if (!open) setChecked(false);
  }, [open]);

  const handleAccept = () => {
    if (!checked || accepting) return;
    void accept(viewLocale);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl max-h-[85vh] flex flex-col [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("gate-title")}</DialogTitle>
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
          <Tabs defaultValue="terms" className="flex-1 min-h-0">
            <TabsList>
              <TabsTrigger value="terms">{t("tab-terms")}</TabsTrigger>
              <TabsTrigger value="privacy">{t("tab-privacy")}</TabsTrigger>
              <TabsTrigger value="imprint">{t("tab-imprint")}</TabsTrigger>
            </TabsList>
            <TabsContent value="terms" className="overflow-y-auto max-h-[50vh]">
              <MarkdownContent content={documents?.terms_body ?? ""} />
            </TabsContent>
            <TabsContent
              value="privacy"
              className="overflow-y-auto max-h-[50vh]"
            >
              <MarkdownContent content={documents?.privacy_body ?? ""} />
            </TabsContent>
            <TabsContent
              value="imprint"
              className="overflow-y-auto max-h-[50vh]"
            >
              <MarkdownContent content={documents?.imprint_body ?? ""} />
            </TabsContent>
          </Tabs>
        )}

        <label className="flex items-start gap-2 text-sm pt-2 border-t">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{t("gate-checkbox-label")}</span>
        </label>

        <DialogFooter>
          <Button onClick={handleAccept} disabled={!checked || accepting}>
            {t("gate-accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
