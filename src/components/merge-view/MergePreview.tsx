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

  return (
    <div className="rounded-md border flex-1 overflow-hidden flex flex-col">
      <div className="p-4 border-b bg-muted/50">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">{t("title")}</div>
          <div className="text-sm text-muted-foreground">
            {t("merge-preview-number", {
              mergedCount: previewData.mergedCount,
              totalMembers: previewData.totalMembers,
            })}
          </div>
        </div>
      </div>

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
