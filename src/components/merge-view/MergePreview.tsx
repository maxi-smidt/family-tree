import { Member } from "@/types/member";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type MergePreviewProps = {
  previewData: {
    conflicts: Member[];
    mergedCount: number;
    totalMembers: number;
  } | null;
};

export const MergePreview = ({ previewData }: MergePreviewProps) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "merge-view.preview",
  });

  if (!previewData) return null;

  const duplicateCount = previewData.conflicts.length;
  const uniqueCount = previewData.mergedCount;

  return (
    <div className="rounded-md border flex-1 overflow-hidden flex flex-col">
      <div className="p-4 border-b bg-muted/50">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">{t("title")}</div>
          <div className="text-sm text-muted-foreground">
            {t("merge-preview-number", {
              mergedCount: previewData.mergedCount,
              totalMembers: previewData.totalMembers,
            })}
          </div>
        </div>

        {/* Summary statistics */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground">Total Records</div>
            <div className="font-semibold text-lg">
              {previewData.totalMembers}
            </div>
          </div>
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground">Unique Members</div>
            <div className="font-semibold text-lg text-green-600">
              {uniqueCount}
            </div>
          </div>
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground">Duplicates Found</div>
            <div className="font-semibold text-lg text-amber-600">
              {duplicateCount}
            </div>
          </div>
        </div>
      </div>

      {/* Info alerts */}
      {duplicateCount > 0 && (
        <div className="p-3 border-b bg-amber-50 dark:bg-amber-950/20">
          <Alert className="bg-transparent border-none p-0">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-sm mb-1">
              Duplicates Will Be Merged
            </AlertTitle>
            <AlertDescription className="text-xs">
              {duplicateCount} member{duplicateCount !== 1 ? "s" : ""} found in
              both databases will be merged. Additional notes from both records
              will be combined.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {duplicateCount === 0 && (
        <div className="p-3 border-b bg-green-50 dark:bg-green-950/20">
          <Alert className="bg-transparent border-none p-0">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-sm mb-1">No Duplicates</AlertTitle>
            <AlertDescription className="text-xs">
              All members are unique. The databases will be combined without any
              conflicts.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="overflow-auto flex-1">
        {previewData.conflicts.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6 text-muted-foreground">
            {t("no-overlap")}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead>{t("table.firstname")}</TableHead>
                <TableHead>{t("table.lastname")}</TableHead>
                <TableHead>{t("table.birth-date")}</TableHead>
                <TableHead className="text-right">
                  {t("table.status")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.conflicts.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.firstName}</TableCell>
                  <TableCell>{m.lastName}</TableCell>
                  <TableCell>{m.date.birth}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      {t("table.will-be-merged")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};
