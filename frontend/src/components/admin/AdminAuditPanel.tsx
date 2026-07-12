import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AdminAuditEntry,
  AdminAuditFilters,
  AdminService,
} from "@/services/AdminService";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/utils/dateUtils";

const PAGE_SIZE = 50;
const ACTIONS = ["create", "update", "delete"] as const;
// Radix's Select forbids an empty-string item value, so "all" is the sentinel
// for "no filter" and is mapped back to undefined before hitting the API.
const ALL = "all";

/** Debounce free-text so typing an actor filter doesn't fire a request per key. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function AdminAuditPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.audit" });

  const [actor, setActor] = useState("");
  const [action, setAction] = useState<string>(ALL);
  const [subjectType, setSubjectType] = useState<string>(ALL);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const debouncedActor = useDebounced(actor);

  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [subjectTypes, setSubjectTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters: AdminAuditFilters = useMemo(
    () => ({
      actor: debouncedActor.trim() || undefined,
      action: action === ALL ? undefined : action,
      subjectType: subjectType === ALL ? undefined : subjectType,
      start: start || undefined,
      end: end || undefined,
    }),
    [debouncedActor, action, subjectType, start, end],
  );

  const hasActiveFilters =
    actor !== "" ||
    action !== ALL ||
    subjectType !== ALL ||
    start !== "" ||
    end !== "";

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setOffset(0);
  }, [filters]);

  // Changing a filter while on a later page fires two loads in quick
  // succession; a sequence guard makes sure the last one dispatched wins even
  // if responses arrive out of order.
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const page = await AdminService.listAuditLog({
        ...filters,
        limit: PAGE_SIZE,
        offset,
      });
      if (id !== requestId.current) return;
      setEntries(page.items);
      setTotal(page.total);
    } catch (err) {
      if (id !== requestId.current) return;
      console.error(err);
      setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    AdminService.listAuditSubjectTypes()
      .then(setSubjectTypes)
      .catch((err) => console.error(err));
  }, []);

  const clearFilters = () => {
    setActor("");
    setAction(ALL);
    setSubjectType(ALL);
    setStart("");
    setEnd("");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await AdminService.exportAuditLog(filters);
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
      const a = document.createElement("a");
      a.href = url;
      a.download = `admin-audit-${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(t("export-error"));
    } finally {
      setExporting(false);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("filters.actor")}
          </label>
          <Input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder={t("filters.actor-placeholder")}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("filters.action")}
          </label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`actions.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("filters.subject")}
          </label>
          <Select value={subjectType} onValueChange={setSubjectType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {subjectTypes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("filters.start")}
          </label>
          <Input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("filters.end")}
          </label>
          <Input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-40"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("filters.clear")}
          </Button>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            disabled={exporting || total === 0}
          >
            {exporting ? t("exporting") : t("export")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{t("error")}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : loading && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasActiveFilters ? t("empty-filtered") : t("empty")}
        </p>
      ) : (
        <>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead>{t("actor")}</TableHead>
                  <TableHead>{t("action")}</TableHead>
                  <TableHead>{t("subject")}</TableHead>
                  <TableHead>{t("details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell>
                      {entry.actor_username ?? t("unknown")}
                    </TableCell>
                    <TableCell>{t(`actions.${entry.action}`)}</TableCell>
                    <TableCell>
                      {entry.subject_label ?? entry.subject_type}
                      {entry.subject_label && ` (${entry.subject_type})`}
                    </TableCell>
                    <TableCell className="max-w-80 whitespace-pre-wrap break-words font-mono text-xs">
                      {entry.details ? JSON.stringify(entry.details) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("showing", { from, to, total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canPrev || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t("previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canNext || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
