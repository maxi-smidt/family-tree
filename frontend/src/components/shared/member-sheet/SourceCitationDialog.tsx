import { useState, useEffect, useRef } from "react";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus, Paperclip, Link, X, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSourceStore } from "@/hooks/useSourceStore";
import { Citation, EvidenceOps, FACT_TYPES, FactType, Source } from "@/types/source";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  citation?: Citation | null;
}

const EMPTY_SOURCE_INPUT = {
  title: "",
  author: "",
  publicationInfo: "",
  repository: "",
  sourceDate: "",
  notes: "",
};

const NEW_SOURCE_SENTINEL = "__new__";

export const SourceCitationDialog = ({
  open,
  onOpenChange,
  memberId,
  citation,
}: Props) => {
  const { t, i18n } = useTranslation();
  const tD = (k: string) => t(`sheet.member-sheet.sources.dialog.${k}`);
  const { sources, addSource, updateSource, addCitation, updateCitation } =
    useSourceStore();

  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [newSource, setNewSource] = useState(EMPTY_SOURCE_INPUT);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [factType, setFactType] = useState<FactType>("general");
  const [page, setPage] = useState("");
  const [detail, setDetail] = useState("");
  const [evidenceOps, setEvidenceOps] = useState<EvidenceOps>({
    addedFiles: [],
    addedLinks: [],
    removedIds: [],
    renamed: [],
  });
  const [linkInput, setLinkInput] = useState("");
  const [linkLabelInput, setLinkLabelInput] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingCitationSource: Source | undefined = citation
    ? sources.find((s) => s.id === citation.sourceId)
    : undefined;

  useEffect(() => {
    if (!open) return;
    if (citation) {
      setSelectedSourceId(citation.sourceId);
      setFactType(citation.factType);
      setPage(citation.page ?? "");
      setDetail(citation.detail ?? "");
      setIsCreatingNew(false);
      setNewSource(EMPTY_SOURCE_INPUT);
    } else {
      setSelectedSourceId("");
      setFactType("general");
      setPage("");
      setDetail("");
      setIsCreatingNew(false);
      setNewSource(EMPTY_SOURCE_INPUT);
    }
    setEvidenceOps({ addedFiles: [], addedLinks: [], removedIds: [], renamed: [] });
    setLinkInput("");
    setLinkLabelInput("");
    setShowLinkForm(false);
  }, [open, citation]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEvidenceOps((prev) => ({
        ...prev,
        addedFiles: [
          ...prev.addedFiles,
          { filename: file.name, dataUrl: ev.target?.result as string },
        ],
      }));
    };
    reader.readAsDataURL(file);
  };

  const removeAddedFile = (idx: number) => {
    setEvidenceOps((prev) => ({
      ...prev,
      addedFiles: prev.addedFiles.filter((_, i) => i !== idx),
    }));
  };

  const addLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    setEvidenceOps((prev) => ({
      ...prev,
      addedLinks: [
        ...prev.addedLinks,
        { url, label: linkLabelInput.trim() || url },
      ],
    }));
    setLinkInput("");
    setLinkLabelInput("");
    setShowLinkForm(false);
  };

  const removeAddedLink = (idx: number) => {
    setEvidenceOps((prev) => ({
      ...prev,
      addedLinks: prev.addedLinks.filter((_, i) => i !== idx),
    }));
  };

  const removeExistingEvidence = (id: string) => {
    setEvidenceOps((prev) => ({
      ...prev,
      removedIds: [...prev.removedIds, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalSourceId = selectedSourceId;

    if (isCreatingNew) {
      if (!newSource.title.trim()) return;
      const created = await addSource(
        {
          title: newSource.title,
          author: newSource.author,
          publicationInfo: newSource.publicationInfo,
          repository: newSource.repository,
          sourceDate: newSource.sourceDate,
          notes: newSource.notes,
        },
        evidenceOps,
      );
      if (!created) return;
      finalSourceId = created.id;
    } else if (existingCitationSource) {
      await updateSource(existingCitationSource.id, {
        title: existingCitationSource.title,
        author: existingCitationSource.author ?? "",
        publicationInfo: existingCitationSource.publicationInfo ?? "",
        repository: existingCitationSource.repository ?? "",
        sourceDate: existingCitationSource.sourceDate ?? "",
        notes: existingCitationSource.notes ?? "",
      }, evidenceOps);
    }

    if (citation) {
      await updateCitation(citation.id, { factType, page, detail });
    } else {
      if (!finalSourceId) return;
      await addCitation({
        sourceId: finalSourceId,
        memberId,
        factType,
        page,
        detail,
      });
    }

    onOpenChange(false);
  };

  const canSubmit = isCreatingNew
    ? newSource.title.trim().length > 0
    : selectedSourceId.length > 0;

  const displayedEvidence =
    existingCitationSource?.evidence.filter(
      (e) => !evidenceOps.removedIds.includes(e.id),
    ) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {citation ? tD("edit-title") : tD("add-title")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 py-2 px-1 max-h-[60vh] overflow-y-auto">
            {/* Source picker / create */}
            {!citation && (
              <div className="space-y-2">
                <Label>{tD("source-label")} *</Label>
                {!isCreatingNew ? (
                  <>
                    <Popover
                      open={sourcePickerOpen}
                      onOpenChange={setSourcePickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={sourcePickerOpen}
                          className="w-full justify-between"
                          type="button"
                        >
                          {selectedSourceId
                            ? (sources.find((s) => s.id === selectedSourceId)
                                ?.title ?? tD("source-placeholder"))
                            : tD("source-placeholder")}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0">
                        <Command>
                          <CommandInput
                            placeholder={tD("source-search-placeholder")}
                          />
                          <CommandList>
                            <CommandEmpty>{tD("source-empty")}</CommandEmpty>
                            <CommandGroup>
                              {sources.map((src) => (
                                <CommandItem
                                  key={src.id}
                                  value={src.title}
                                  onSelect={() => {
                                    setSelectedSourceId(
                                      src.id === selectedSourceId ? "" : src.id,
                                    );
                                    setSourcePickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedSourceId === src.id
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  {src.title}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                            {sources.length > 0 && <CommandSeparator />}
                            <CommandGroup>
                              <CommandItem
                                value={NEW_SOURCE_SENTINEL}
                                onSelect={() => {
                                  setIsCreatingNew(true);
                                  setSelectedSourceId("");
                                  setSourcePickerOpen(false);
                                }}
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                {tD("source-new")}
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </>
                ) : (
                  <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{tD("source-new")}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => setIsCreatingNew(false)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{tD("source-title")} *</Label>
                      <Input
                        value={newSource.title}
                        onChange={(e) =>
                          setNewSource((p) => ({ ...p, title: e.target.value }))
                        }
                        placeholder={tD("source-title-placeholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{tD("author")}</Label>
                      <Input
                        value={newSource.author}
                        onChange={(e) =>
                          setNewSource((p) => ({ ...p, author: e.target.value }))
                        }
                        placeholder={tD("author-placeholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{tD("repository")}</Label>
                      <Input
                        value={newSource.repository}
                        onChange={(e) =>
                          setNewSource((p) => ({
                            ...p,
                            repository: e.target.value,
                          }))
                        }
                        placeholder={tD("repository-placeholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{tD("source-date")}</Label>
                      <PartialDatePicker
                        value={newSource.sourceDate || null}
                        onChange={(value) =>
                          setNewSource((p) => ({
                            ...p,
                            sourceDate: value ?? "",
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{tD("notes")}</Label>
                      <Textarea
                        value={newSource.notes}
                        onChange={(e) =>
                          setNewSource((p) => ({ ...p, notes: e.target.value }))
                        }
                        placeholder={tD("notes-placeholder")}
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Fact type */}
            <div className="space-y-2">
              <Label>{tD("fact-type")} *</Label>
              <Select
                value={factType}
                onValueChange={(v) => setFactType(v as FactType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACT_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {i18n.t(`sheet.member-sheet.sources.fact.${ft}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Page / folio */}
            <div className="space-y-2">
              <Label>{tD("page")}</Label>
              <Input
                value={page}
                onChange={(e) => setPage(e.target.value)}
                placeholder={tD("page-placeholder")}
              />
            </div>

            {/* Transcription / detail */}
            <div className="space-y-2">
              <Label>{tD("detail")}</Label>
              <Textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder={tD("detail-placeholder")}
                rows={3}
              />
            </div>

            {/* Evidence — only when creating a new source or editing existing */}
            {(isCreatingNew || existingCitationSource) && (
              <div className="space-y-2">
                <Label>{tD("evidence")}</Label>
                <p className="text-xs text-muted-foreground">
                  {tD("evidence-hint")}
                </p>

                {/* Existing evidence (when editing) */}
                {displayedEvidence.length > 0 && (
                  <div className="space-y-1">
                    {displayedEvidence.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-2 text-sm border rounded px-2 py-1"
                      >
                        {ev.kind === "file" ? (
                          <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <Link className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate">
                          {ev.filename ?? ev.url}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          className="h-6 w-6 p-0"
                          onClick={() => removeExistingEvidence(ev.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pending new files */}
                {evidenceOps.addedFiles.map((f, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm border rounded px-2 py-1 bg-muted/30"
                  >
                    <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.filename}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="h-6 w-6 p-0"
                      onClick={() => removeAddedFile(idx)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}

                {/* Pending new links */}
                {evidenceOps.addedLinks.map((lnk, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm border rounded px-2 py-1 bg-muted/30"
                  >
                    <Link className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{lnk.label || lnk.url}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="h-6 w-6 p-0"
                      onClick={() => removeAddedLink(idx)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}

                {/* Link form */}
                {showLinkForm && (
                  <div className="border rounded-md p-2 space-y-2 bg-muted/20">
                    <Input
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder={tD("link-url-placeholder")}
                    />
                    <Input
                      value={linkLabelInput}
                      onChange={(e) => setLinkLabelInput(e.target.value)}
                      placeholder={tD("link-label-placeholder")}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" type="button" onClick={addLink}>
                        {tD("link-add")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => {
                          setShowLinkForm(false);
                          setLinkInput("");
                          setLinkLabelInput("");
                        }}
                      >
                        {tD("cancel")}
                      </Button>
                    </div>
                  </div>
                )}

                {!showLinkForm && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="w-3.5 h-3.5 mr-1" />
                      {tD("add-file")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => setShowLinkForm(true)}
                    >
                      <Link className="w-3.5 h-3.5 mr-1" />
                      {tD("add-link")}
                    </Button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {tD("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {tD("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
