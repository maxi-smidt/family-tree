import { Input } from "@/components/ui/input";
import { LocationInput } from "@/components/shared/LocationInput";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { ApiError } from "@/services/api";
import { getQuotaBucket, quotaToastKey } from "@/lib/quotaError";
import { MarkdownEditor } from "@/components/shared/member-sheet/MarkdownEditor";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useFeature } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Mars,
  Plus,
  Trash2,
  Upload,
  User,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { Gender, Member } from "@/types/member";
import { ImageCropDialog } from "@/components/shared/member-sheet/dialog/ImageCropDialog";
import { toast } from "sonner";
import debounce from "lodash.debounce";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { useTranslation } from "react-i18next";
import { comparePartialDates } from "@/utils/dateUtils";
import { MemberEvents } from "./MemberEvents";
import { MemberStories } from "./MemberStories";
import { MemberDiseases } from "./MemberDiseases";
import { MemberDocuments } from "./MemberDocuments";
import { MemberPicker } from "./MemberPicker";
import { MemberPhotos } from "./MemberPhotos";
import { LinkedTreeField } from "./LinkedTreeField";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { MemberSheetTab } from "@/utils/memberSheetState";

function getDescendants(memberId: string, allMembers: Member[]): Set<string> {
  const descendants = new Set<string>();
  const queue = [memberId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const m of allMembers) {
      if (
        (m.parents.paternalParent === current ||
          m.parents.maternalParent === current) &&
        !descendants.has(m.id)
      ) {
        descendants.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return descendants;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  member: Member;
  isNew?: boolean;
  onSaved?: (data: Member) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveStatusChange?: (status: SaveStatus) => void;
  onAutosaveFlush?: (flush: () => Promise<void>) => void;
  activeTab: MemberSheetTab;
  onTabChange: (tab: MemberSheetTab) => void;
};

export const EditMode = ({
  member,
  isNew = false,
  onSaved,
  onDirtyChange,
  onSaveStatusChange,
  onAutosaveFlush,
  activeTab,
  onTabChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode",
  });
  const { updateMemberPartial, members } = useMemberStore();
  const restrictions = useTreeStore((s) => s.selectedTree?.restrictions ?? []);
  const currentTreeId = useTreeStore((s) => s.selectedTree?.id);
  const treeLinksEnabled = useFeature("tree_links");
  const eventsEnabled =
    useFeature("events") && !restrictions.includes("events");
  const storiesEnabled =
    useFeature("stories") && !restrictions.includes("stories");
  const documentsEnabled =
    useFeature("sources") && !restrictions.includes("sources");
  const galleryEnabled =
    useFeature("gallery") && !restrictions.includes("gallery");
  const diseasesEnabled = !restrictions.includes("diseases");
  const mapEnabled = !restrictions.includes("map");
  const biographyEnabled = !restrictions.includes("biography");

  const [formData, setFormData] = useState<Member>(member);
  const [initialData, setInitialData] = useState<Member>(member);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
  }>({});
  const [recordsMounted, setRecordsMounted] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // These identifiers are deliberately captured for the editor's lifetime.
  // A delayed save must never resolve the currently active tree after a switch.
  const editorTreeIdRef = useRef(currentTreeId);
  const editorMemberIdRef = useRef(member.id);
  const formDataRef = useRef(formData);
  const isDirtyRef = useRef(isDirty);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRevisionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const lastDuplicateSignatureRef = useRef<string | null>(null);

  formDataRef.current = formData;
  isDirtyRef.current = isDirty;

  useEffect(() => {
    setFormData(member);
    setInitialData(member);
    setErrors({});
    setIsDirty(false);
    onDirtyChange?.(false);
    // Autosave (for existing members) persists in place and updates the
    // `member` prop identity without the user switching members — only reset
    // the form when a genuinely different member is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  useEffect(() => {
    const dirty =
      (formData.academicTitle || "") !== (initialData.academicTitle || "") ||
      formData.firstName !== initialData.firstName ||
      (formData.middleNames || "") !== (initialData.middleNames || "") ||
      (formData.baptismalName || "") !== (initialData.baptismalName || "") ||
      formData.lastName !== initialData.lastName ||
      (formData.maidenName || "") !== (initialData.maidenName || "") ||
      formData.gender !== initialData.gender ||
      (formData.imageData || "") !== (initialData.imageData || "") ||
      formData.date.birth !== initialData.date.birth ||
      (formData.date.death || "") !== (initialData.date.death || "") ||
      formData.deceased !== initialData.deceased ||
      formData.adopted !== initialData.adopted ||
      (formData.additionalData || "") !== (initialData.additionalData || "") ||
      (formData.birthplace || "") !== (initialData.birthplace || "") ||
      (formData.hometown || "") !== (initialData.hometown || "") ||
      (formData.cemetery || "") !== (initialData.cemetery || "") ||
      JSON.stringify(formData.placesLived) !==
        JSON.stringify(initialData.placesLived) ||
      formData.parents.paternalParent !== initialData.parents.paternalParent ||
      formData.parents.maternalParent !== initialData.parents.maternalParent ||
      (formData.linkedTreeId ?? null) !== (initialData.linkedTreeId ?? null);

    setIsDirty(dirty);
    onDirtyChange?.(dirty);
  }, [formData, initialData, onDirtyChange]);

  const eligibleParents = useMemo(() => {
    const excluded = getDescendants(member.id, members);
    excluded.add(member.id);
    return members.filter((m) => !excluded.has(m.id));
  }, [member.id, members]);

  const handleChange = (field: keyof Member, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  function handleSelectImage() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string);
    };
    reader.onerror = () => toast.error(t("toast-error-file"));
    reader.readAsDataURL(file);
  }

  const onConfirm = (imageData: string) => {
    handleChange("imageData", imageData);
    setSelectedImage(null);
  };

  const handleDateChange = (
    field: "birth" | "death",
    dateString: string | null,
  ) => {
    if (field === "death" && dateString && formData.date.birth) {
      if (comparePartialDates(dateString, formData.date.birth) < 0) {
        toast.error(t("toast-error-death"));
        return;
      }
    }

    if (field === "birth" && dateString && formData.date.death) {
      if (comparePartialDates(formData.date.death, dateString) < 0) {
        toast.error(t("toast-error-birth"));
        return;
      }
    }

    setFormData((prev) => ({
      ...prev,
      deceased: field === "death" && dateString ? true : prev.deceased,
      date: {
        ...prev.date,
        [field]: dateString,
      },
    }));
  };

  const handleGenderChange = (value: Gender) => {
    if (!value) return;
    handleChange("gender", value);
  };

  const persistSnapshot = useCallback(
    async (
      snapshot: Member,
      revision: number,
      opts?: { autosave?: boolean },
    ): Promise<boolean> => {
      const isCurrent = () => revision === latestSaveRevisionRef.current;
      const nextErrors: { firstName?: string; lastName?: string } = {};
      if (!snapshot.firstName.trim())
        nextErrors.firstName = t("error-firstname-required");
      if (!snapshot.lastName.trim())
        nextErrors.lastName = t("error-lastname-required");
      if (isCurrent()) setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        if (opts?.autosave && isCurrent()) {
          setSaveStatus("idle");
        } else if (!opts?.autosave && isCurrent()) {
          (nextErrors.firstName ? firstNameRef : lastNameRef).current?.focus();
        }
        return false;
      }

      // Same-named people are only treated as duplicates once a birth date has
      // been entered; without one we allow namesakes to be created freely.
      const duplicate = snapshot.date.birth
        ? members.find(
            (m) =>
              m.id !== member.id &&
              m.firstName === snapshot.firstName &&
              (m.middleNames || "") === (snapshot.middleNames || "") &&
              (m.baptismalName || "") === (snapshot.baptismalName || "") &&
              m.lastName === snapshot.lastName &&
              m.gender === snapshot.gender &&
              m.date.birth === snapshot.date.birth &&
              m.date.death === snapshot.date.death,
          )
        : undefined;

      if (duplicate) {
        const signature = [
          snapshot.firstName,
          snapshot.middleNames || "",
          snapshot.baptismalName || "",
          snapshot.lastName,
          snapshot.gender,
          snapshot.date.birth,
          snapshot.date.death || "",
        ].join("|");
        if (isCurrent() && lastDuplicateSignatureRef.current !== signature) {
          toast.error(t("toast-error-duplicate"));
          lastDuplicateSignatureRef.current = signature;
        }
        if (isCurrent()) setSaveStatus("error");
        return false;
      }
      if (isCurrent()) lastDuplicateSignatureRef.current = null;

      if (isNew) {
        onSaved?.(snapshot);
        return true;
      }

      setSaveStatus("saving");
      try {
        const treeId = editorTreeIdRef.current;
        if (!treeId) return false;
        const result = await updateMemberPartial(
          editorMemberIdRef.current,
          {
            academicTitle: snapshot.academicTitle || null,
            firstName: snapshot.firstName,
            middleNames: snapshot.middleNames || null,
            baptismalName: snapshot.baptismalName || null,
            lastName: snapshot.lastName,
            maidenName: snapshot.maidenName || null,
            gender: snapshot.gender,
            imageData: snapshot.imageData || undefined,
            dateOfBirth: snapshot.date.birth,
            dateOfDeath: snapshot.date.death || null,
            deceased: snapshot.deceased,
            adopted: snapshot.adopted,
            additionalData: snapshot.additionalData || null,
            birthplace: snapshot.birthplace || null,
            hometown: snapshot.hometown || null,
            cemetery: snapshot.cemetery || null,
            placesLived:
              snapshot.placesLived.length > 0
                ? JSON.stringify(snapshot.placesLived)
                : null,
            paternalParentId: snapshot.parents.paternalParent,
            maternalParentId: snapshot.parents.maternalParent,
            ...(snapshot.linkedTreeId !== undefined
              ? { linkedTreeId: snapshot.linkedTreeId }
              : {}),
          },
          treeId,
        );
        if (!opts?.autosave && isCurrent()) {
          toast.success(t("toast-success"));
        }
        // Bridge person whose counterpart tree the editor may not write: the
        // save worked but the linked copy drifted — say so.
        if (isCurrent() && result?.bridgeSync === "skipped_no_access") {
          toast.info(t("toast-bridge-sync-skipped"));
        }
        // Settle the dirty baseline on the snapshot that was actually
        // persisted — if the user kept typing during the in-flight save,
        // formData has since moved on and stays (correctly) dirty.
        // Serialization prevents reordered writes; this guard also prevents an
        // older response from replacing the status of a newer queued revision.
        if (isCurrent()) {
          setInitialData(snapshot);
          setSaveStatus("saved");
        }
        if (!opts?.autosave && isCurrent()) {
          onSaved?.(snapshot);
        }
        return true;
      } catch (err: unknown) {
        if (!isCurrent()) return false;
        if (err instanceof ApiError && err.status === 413) {
          const bucket = getQuotaBucket(err.message);
          if (bucket) {
            toast.error(t(quotaToastKey(bucket)));
          } else {
            toast.error(t("toast-error-image-too-large"));
          }
        } else if (err instanceof ApiError && err.status === 400) {
          toast.error(t("toast-error-image-unsupported"));
        } else {
          toast.error(t("toast-error-save"));
        }
        setSaveStatus("error");
        return false;
      }
    },
    [members, isNew, onSaved, t, updateMemberPartial],
  );

  // Saves are serialized through one chain.  The debounce below coalesces
  // rapid form changes into one queued snapshot, and every response carries a
  // revision so a late result cannot overwrite newer editor state.
  const save = useCallback(
    (opts?: { autosave?: boolean }): Promise<boolean> => {
      const snapshot = formDataRef.current;
      const revision = ++latestSaveRevisionRef.current;
      const task = saveChainRef.current.then(() =>
        persistSnapshot(snapshot, revision, opts),
      );
      saveChainRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [persistSnapshot],
  );

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  // Keep a stable debounced trigger that always calls the freshest `save`
  // (via a ref) so the debounce doesn't need to be recreated on every
  // keystroke, which would otherwise reset its timer.
  const saveRef = useRef(save);
  saveRef.current = save;
  const autosave = useMemo(
    () =>
      debounce(() => {
        return saveRef.current({ autosave: true });
      }, 800),
    [],
  );

  const flushAutosave = useCallback(async () => {
    if (isDirtyRef.current) {
      await autosave.flush();
    }
    await saveChainRef.current;
  }, [autosave]);

  useEffect(() => {
    onAutosaveFlush?.(flushAutosave);
    return () => onAutosaveFlush?.(async () => {});
  }, [flushAutosave, onAutosaveFlush]);

  // Existing members autosave; new members are purely client-side until an
  // explicit "Create member" action, so autosave never applies to them.
  useEffect(() => {
    if (isNew) return;
    if (isDirty) {
      setSaveStatus("saving");
      autosave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, isDirty, isNew, autosave]);

  // Flush a pending autosave on unmount (sheet closing, switching members)
  // so an in-progress debounce never silently loses the last edit.
  useEffect(() => {
    if (isNew) return;
    return () => {
      // React unmount cannot await cleanup.  The request still targets the
      // captured tree/member pair, so a tree switch cannot misdirect it.
      void flushAutosave();
    };
  }, [flushAutosave, isNew]);

  // Only new members need the global unsaved-changes navigation guard —
  // existing members autosave and flush any pending change on unmount, so
  // there's never an unsaved change to interrupt navigation for.
  useUnsavedGuard(
    "member-edit",
    isNew && isDirty,
    useCallback(() => save(), [save]),
  );

  return (
    <form id="edit-member-form" onSubmit={handleSave} className="flex flex-col">
      <div className="nodrag">
        <label className="block relative mb-4 cursor-pointer group w-fit mx-auto">
          {formData.imageData ? (
            <AuthenticatedImage
              src={formData.imageData}
              className="size-24 rounded-full object-cover mx-auto bg-gray-100"
              alt="Profile"
              fallback={
                <div className="size-24 flex justify-center items-center rounded-full mx-auto bg-muted text-2xl font-bold text-muted-foreground">
                  <User size={48} />
                </div>
              }
            />
          ) : (
            <div className="size-24 flex justify-center items-center rounded-full mx-auto bg-muted text-2xl font-bold text-muted-foreground">
              <User size={48} />
            </div>
          )}
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleSelectImage}
          >
            <Upload className="text-white w-6 h-6" />
          </div>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <ImageCropDialog
          isOpen={!!selectedImage}
          imageData={selectedImage}
          onConfirm={onConfirm}
          onCancel={() => setSelectedImage(null)}
        />

        <Tabs
          value={
            isNew && (activeTab === "relations" || activeTab === "records")
              ? "identity"
              : activeTab
          }
          onValueChange={(v) => {
            onTabChange(v as MemberSheetTab);
            if (v === "records") setRecordsMounted(true);
          }}
        >
          <TabsList variant="line" className="w-full justify-start mb-3">
            <TabsTrigger value="identity">{t("tab-identity")}</TabsTrigger>
            <TabsTrigger value="life">{t("tab-life")}</TabsTrigger>
            {!isNew && (
              <TabsTrigger value="relations">{t("tab-relations")}</TabsTrigger>
            )}
            {!isNew && (
              <TabsTrigger value="records">{t("tab-records")}</TabsTrigger>
            )}
          </TabsList>

          {/* Identity tab */}
          <TabsContent value="identity">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("academic-title-field")}
                </FieldLabel>
                <Input
                  id="academicTitle"
                  value={formData.academicTitle || ""}
                  className="h-7 text-xs! shadow-none"
                  placeholder={t("academic-title-placeholder")}
                  onChange={(e) =>
                    handleChange("academicTitle", e.target.value)
                  }
                />
              </Field>

              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("gender-field")}
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={formData.gender}
                  onValueChange={(val) => handleGenderChange(val as Gender)}
                  className="justify-start"
                >
                  <ToggleGroupItem
                    value="m"
                    aria-label={t("gender-male")}
                    className="h-7 min-w-7 text-xs"
                  >
                    <Mars />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="f"
                    aria-label={t("gender-female")}
                    className="h-7 min-w-7 text-xs"
                  >
                    <Venus />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="o"
                    aria-label={t("gender-other")}
                    className="h-7 min-w-7 text-xs"
                  >
                    <VenusAndMars />
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!errors.firstName}>
                  <FieldLabel
                    htmlFor="firstName"
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("firstname-field")}
                  </FieldLabel>
                  <Input
                    ref={firstNameRef}
                    id="firstName"
                    required
                    aria-required="true"
                    aria-invalid={!!errors.firstName}
                    aria-describedby={
                      errors.firstName ? "firstName-error" : undefined
                    }
                    value={formData.firstName}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("firstname-placeholder")}
                    onChange={(e) => {
                      handleChange("firstName", e.target.value);
                      if (errors.firstName)
                        setErrors((p) => ({ ...p, firstName: undefined }));
                    }}
                  />
                  <FieldError id="firstName-error">
                    {errors.firstName}
                  </FieldError>
                </Field>

                <Field data-invalid={!!errors.lastName}>
                  <FieldLabel
                    htmlFor="lastName"
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("lastname-field")}
                  </FieldLabel>
                  <Input
                    ref={lastNameRef}
                    id="lastName"
                    required
                    aria-required="true"
                    aria-invalid={!!errors.lastName}
                    aria-describedby={
                      errors.lastName ? "lastName-error" : undefined
                    }
                    value={formData.lastName}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("lastname-field")}
                    onChange={(e) => {
                      handleChange("lastName", e.target.value);
                      if (errors.lastName)
                        setErrors((p) => ({ ...p, lastName: undefined }));
                    }}
                  />
                  <FieldError id="lastName-error">{errors.lastName}</FieldError>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("middle-names-field")}
                  </FieldLabel>
                  <Input
                    id="middleNames"
                    value={formData.middleNames || ""}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("middle-names-field")}
                    onChange={(e) =>
                      handleChange("middleNames", e.target.value)
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("maiden-field")}
                  </FieldLabel>
                  <Input
                    id="maidenName"
                    value={formData.maidenName || ""}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("lastname-field")}
                    onChange={(e) => handleChange("maidenName", e.target.value)}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("baptismal-name-field")}
                </FieldLabel>
                <Input
                  id="baptismalName"
                  value={formData.baptismalName || ""}
                  className="h-7 text-xs! shadow-none"
                  placeholder={t("baptismal-name-field")}
                  onChange={(e) =>
                    handleChange("baptismalName", e.target.value)
                  }
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          {/* Life tab */}
          <TabsContent value="life">
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("born-field")}
                  </FieldLabel>
                  <PartialDatePicker
                    className="h-7 text-xs shadow-none border-input"
                    value={formData.date.birth}
                    onChange={(date) => handleDateChange("birth", date)}
                    placeholder={t("date-placeholder")}
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("birthplace-field")}
                  </FieldLabel>
                  <LocationInput
                    id="birthplace"
                    value={formData.birthplace}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("location-placeholder")}
                    geocodeEnabled={mapEnabled}
                    onChange={(value) => handleChange("birthplace", value)}
                  />
                </Field>
              </div>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("deceased-field")}
                  </FieldLabel>
                  <Switch
                    checked={formData.deceased}
                    onCheckedChange={(checked) => {
                      setFormData((prev) => ({
                        ...prev,
                        deceased: checked,
                        date: {
                          ...prev.date,
                          death: checked ? prev.date.death : null,
                        },
                      }));
                    }}
                  />
                </div>
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("adopted-field")}
                  </FieldLabel>
                  <Switch
                    checked={formData.adopted}
                    onCheckedChange={(checked) =>
                      handleChange("adopted", checked)
                    }
                  />
                </div>
              </Field>

              {formData.deceased && (
                <div className={mapEnabled ? "grid grid-cols-2 gap-3" : ""}>
                  <Field>
                    <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                      {t("death-field")}
                    </FieldLabel>
                    <PartialDatePicker
                      className="h-7 text-xs shadow-none border-input"
                      value={formData.date.death}
                      onChange={(date) => handleDateChange("death", date)}
                      placeholder={t("date-placeholder")}
                    />
                  </Field>

                  {mapEnabled && (
                    <Field>
                      <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                        {t("hometown-field")}
                      </FieldLabel>
                      <LocationInput
                        id="hometown"
                        value={formData.hometown}
                        className="h-7 text-xs! shadow-none"
                        placeholder={t("location-placeholder")}
                        onChange={(value) => handleChange("hometown", value)}
                      />
                    </Field>
                  )}
                </div>
              )}

              {formData.deceased && mapEnabled && (
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("cemetery-field")}
                  </FieldLabel>
                  <LocationInput
                    id="cemetery"
                    value={formData.cemetery}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("location-placeholder")}
                    onChange={(value) => handleChange("cemetery", value)}
                  />
                </Field>
              )}

              {!formData.deceased && mapEnabled && (
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("hometown-field")}
                  </FieldLabel>
                  <LocationInput
                    id="hometown"
                    value={formData.hometown}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("location-placeholder")}
                    onChange={(value) => handleChange("hometown", value)}
                  />
                </Field>
              )}

              {mapEnabled && (
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                      {t("places-lived-field")}
                    </FieldLabel>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        handleChange("placesLived", [
                          ...formData.placesLived,
                          { location: "", from: null, to: null },
                        ])
                      }
                    >
                      <Plus className="size-3" />
                      {t("places-lived-add")}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {formData.placesLived.map((place, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-1 border rounded-md p-2"
                      >
                        <LocationInput
                          value={place.location}
                          className="h-7 text-xs! shadow-none"
                          placeholder={t("location-placeholder")}
                          onChange={(value) => {
                            const next = formData.placesLived.map((p, i) =>
                              i === idx ? { ...p, location: value } : p,
                            );
                            handleChange("placesLived", next);
                          }}
                          trailing={
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => {
                                handleChange(
                                  "placesLived",
                                  formData.placesLived.filter(
                                    (_, i) => i !== idx,
                                  ),
                                );
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          }
                        />
                        <div className="flex gap-1">
                          <Input
                            value={place.from || ""}
                            className="h-7 text-xs! shadow-none"
                            placeholder={t("places-lived-from")}
                            onChange={(e) => {
                              const next = formData.placesLived.map((p, i) =>
                                i === idx
                                  ? { ...p, from: e.target.value || null }
                                  : p,
                              );
                              handleChange("placesLived", next);
                            }}
                          />
                          <Input
                            value={place.to || ""}
                            className="h-7 text-xs! shadow-none"
                            placeholder={t("places-lived-to")}
                            onChange={(e) => {
                              const next = formData.placesLived.map((p, i) =>
                                i === idx
                                  ? { ...p, to: e.target.value || null }
                                  : p,
                              );
                              handleChange("placesLived", next);
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {formData.placesLived.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("places-lived-empty")}
                      </p>
                    )}
                  </div>
                </Field>
              )}

              {biographyEnabled && (
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("notes-field")}
                  </FieldLabel>
                  <MarkdownEditor
                    id="additionalData"
                    value={formData.additionalData || ""}
                    placeholder={t("notes-placeholder")}
                    onChange={(value) => handleChange("additionalData", value)}
                  />
                </Field>
              )}
            </FieldGroup>
          </TabsContent>

          {/* Relations tab */}
          {!isNew && (
            <TabsContent value="relations">
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("paternal-parent-field")}
                  </FieldLabel>
                  <MemberPicker
                    members={eligibleParents}
                    value={formData.parents.paternalParent}
                    onChange={(id) =>
                      setFormData((prev) => ({
                        ...prev,
                        parents: { ...prev.parents, paternalParent: id },
                      }))
                    }
                    placeholder={t("parent-placeholder")}
                    noResultsText={t("parent-no-results")}
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("maternal-parent-field")}
                  </FieldLabel>
                  <MemberPicker
                    members={eligibleParents}
                    value={formData.parents.maternalParent}
                    onChange={(id) =>
                      setFormData((prev) => ({
                        ...prev,
                        parents: { ...prev.parents, maternalParent: id },
                      }))
                    }
                    placeholder={t("parent-placeholder")}
                    noResultsText={t("parent-no-results")}
                  />
                </Field>

                {treeLinksEnabled && (
                  <LinkedTreeField
                    currentTreeId={currentTreeId}
                    value={formData.linkedTreeId ?? null}
                    memberName={`${formData.firstName} ${formData.lastName}`}
                    memberId={isNew ? undefined : formData.id}
                    formDirty={isDirty}
                    onChange={(treeId) => handleChange("linkedTreeId", treeId)}
                  />
                )}
              </FieldGroup>
            </TabsContent>
          )}

          {/* Records tab — lazy-mounted on first activate */}
          {!isNew && (
            <TabsContent value="records">
              {recordsMounted && (
                <div className="space-y-4">
                  {galleryEnabled && <MemberPhotos member={member} />}
                  {eventsEnabled && <MemberEvents member={member} />}
                  {storiesEnabled && <MemberStories member={member} />}
                  {documentsEnabled && <MemberDocuments member={member} />}
                  {diseasesEnabled && <MemberDiseases member={member} />}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </form>
  );
};
