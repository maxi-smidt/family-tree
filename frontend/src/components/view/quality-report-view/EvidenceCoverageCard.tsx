import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CitationDialog } from "@/components/shared/evidence/CitationDialog";
import { useCanEditEvidence } from "@/components/shared/evidence/useCanEditEvidence";
import { useCitationStore, useLoadCitations } from "@/hooks/useCitationStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { EvidenceCoverage, MemberFieldCitation } from "@/types/citation";

const SHOWN = 8;

/** Data quality: which filled-in names, dates and birthplaces still lack
 *  evidence, and which cited passages can no longer be found. */
export function EvidenceCoverageCard() {
  const { t } = useTranslation(undefined, {
    keyPrefix: "quality-report-view.evidence",
  });
  const { t: fields } = useTranslation(undefined, {
    keyPrefix: "sheet.evidence.field-lower",
  });
  const loadCoverage = useCitationStore((s) => s.loadCoverage);
  const citations = useCitationStore((s) => s.citations);
  const documentsInitialized = useDocumentStore((s) => s.initialized);
  const refreshDocuments = useDocumentStore((s) => s.refreshDocuments);
  const documents = useDocumentStore((s) => s.documents);
  const members = useMemberStore((s) => s.members);
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const canEdit = useCanEditEvidence();
  const [coverage, setCoverage] = useState<EvidenceCoverage | null>(null);
  const [fixing, setFixing] = useState<MemberFieldCitation | null>(null);
  useLoadCitations();

  // Count again whenever evidence changes here or elsewhere.
  useEffect(() => {
    let cancelled = false;
    loadCoverage()
      .then((loaded) => {
        if (!cancelled) setCoverage(loaded);
      })
      .catch(() => {
        if (!cancelled) setCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCoverage, citations, workspaceId]);

  // Document titles are only needed to list the lost quotes.
  const loadDocuments = useCallback(
    (id: string) => refreshDocuments(id).catch(() => {}),
    [refreshDocuments],
  );
  useDeferredStoreLoad(
    documentsInitialized || !coverage?.quotesNotFound.length,
    loadDocuments,
  );

  const openMember = useCallback(
    (memberId: string) => {
      if (!workspaceId) return;
      setOpenSheet(workspaceId, { memberId, tab: "identity", mode: "view" });
      navigateTo("tree-view");
    },
    [navigateTo, setOpenSheet, workspaceId],
  );

  if (!coverage || coverage.factsTotal === 0) return null;

  const missingCount = coverage.factsTotal - coverage.factsCited;
  const percent = Math.round((coverage.factsCited / coverage.factsTotal) * 100);
  const nameOf = (memberId: string) => {
    const member = members.find((m) => m.id === memberId);
    return member ? `${member.firstName} ${member.lastName}` : t("unknown");
  };

  return (
    <>
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>
            <h2>{t("title")}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("summary", {
              count: coverage.factsTotal,
              missing: missingCount,
            })}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            role="progressbar"
            aria-label={t("progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </div>
          {coverage.missing.length > 0 && (
            <ul className="divide-y">
              {coverage.missing.slice(0, SHOWN).map((entry) => (
                <li
                  key={entry.memberId}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="truncate text-left font-medium hover:underline"
                    onClick={() => openMember(entry.memberId)}
                  >
                    {entry.name || t("unknown")}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.fields.map((field) => fields(field)).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {coverage.missingMemberCount > SHOWN && (
            <p className="text-xs text-muted-foreground">
              {t("more", { count: coverage.missingMemberCount - SHOWN })}
            </p>
          )}
        </CardContent>
      </Card>

      {coverage.quotesNotFound.length > 0 && (
        <Card className="gap-3 border-warning/30">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <TriangleAlert className="size-4 text-warning" />
                {t("lost-title")}
              </h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("lost-description")}
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {coverage.quotesNotFound.map((citation) => {
                const document = documents.find(
                  (d) => d.id === citation.documentId,
                );
                return (
                  <li
                    key={citation.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => openMember(citation.memberId)}
                      >
                        {nameOf(citation.memberId)}
                      </button>{" "}
                      · {fields(citation.field)}
                      {document && (
                        <span className="text-muted-foreground">
                          {" "}
                          {t("in-document", { title: document.title })}
                        </span>
                      )}
                    </span>
                    {canEdit && document && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setFixing(citation)}
                      >
                        {t("fix")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {fixing && (
        <CitationDialog
          open
          onOpenChange={(next) => {
            if (!next) setFixing(null);
          }}
          citation={fixing}
        />
      )}
    </>
  );
}
