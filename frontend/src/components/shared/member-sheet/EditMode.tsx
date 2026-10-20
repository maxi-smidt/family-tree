import { Input } from "@/components/ui/input";
import { canEditArea } from "@/utils/accessLevels";
import { LocationInput } from "@/components/shared/LocationInput";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { ApiError } from "@/services/api";
import { getQuotaBucket, quotaToastKey } from "@/lib/quotaError";
import { MarkdownEditor } from "@/components/shared/member-sheet/MarkdownEditor";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Images,
  Mars,
  Plus,
  Trash2,
  Upload,
  User,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { Gender, Member } from "@/types/member";
import { GalleryImage } from "@/types/gallery";
import { ImageCropDialog } from "@/components/shared/member-sheet/dialog/ImageCropDialog";
import { GalleryPickerDialog } from "@/components/shared/member-sheet/dialog/GalleryPickerDialog";
import { IdentityLinksPanel } from "@/components/shared/member-sheet/IdentityLinksPanel";
import { fetchMediaObjectUrl } from "@/hooks/useMediaUrl";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { useTranslation } from "react-i18next";
import { comparePartialDates } from "@/utils/dateUtils";
import { MemberEvents } from "./MemberEvents";
import { MemberStories } from "./MemberStories";
import { MemberDiseases } from "./MemberDiseases";
import { MemberTasks } from "./MemberTasks";
import { MemberDocuments } from "./MemberDocuments";
import { MemberPicker } from "./MemberPicker";
import { MemberPhotos } from "./MemberPhotos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { MemberSheetTab } from "@/utils/memberSheetState";
import { FieldEvidence } from "@/components/shared/evidence/FieldEvidence";
import { EvidenceChangeWarning } from "@/components/shared/evidence/EvidenceChangeWarning";
import { useLoadCitations } from "@/hooks/useCitationStore";
import { CitableField } from "@/types/citation";
import { citableFieldValue, withCitableFieldValue } from "@/utils/citations";

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
  onSaved?: (data: Member) => Promise<void> | void;
  formId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveStatusChange?: (status: SaveStatus) => void;
  onAutosaveFlush?: (flush: () => Promise<void>) => void;
  activeTab: MemberSheetTab;
  onTabChange: (tab: MemberSheetTab) => void;
};

export const EditMode = ({
  member,
  formId = "edit-member-form",
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
  const fieldId = (name: string) => `${formId}-${name}`;
  const { updateMemberPartial, members } = useMemberStore();
  const { galleryImages } = useGalleryStore();
  const restrictions = useWorkspaceStore((s) => s.selectedTree?.restrictions);
  const currentTreeId = useWorkspaceStore((s) => s.selectedTree?.id);
  // Portraits belong to the Photos area (#1101).
  const canEditPhotos = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "gallery"),
  );
  const eventsEnabled = !restrictions?.includes("events");
  const storiesEnabled = !restrictions?.includes("stories");
  const documentsEnabled = !restrictions?.includes("sources");
  const galleryEnabled = !restrictions?.includes("gallery");
  const tasksEnabled = !restrictions?.includes("tasks");
  const diseasesEnabled = !restrictions?.includes("diseases");
  // The map follows events, and the notes follow stories (#1101).
  const mapEnabled = eventsEnabled;
  const biographyEnabled = storiesEnabled;

  const [formData, setFormData] = useState<Member>(member);
  const [initialData, setInitialData] = useState<Member>(member);
  // The values evidence was cited for: the member as editing started.
  const [evidenceBaseline, setEvidenceBaseline] = useState<Member>(member);
  const showEvidence = documentsEnabled && !isNew;
  useLoadCitations(showEvidence);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
  }>({});
  const [recordsMounted, setRecordsMounted] = useState(activeTab === "records");
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // These identifiers are deliberately captured for the editor's lifetime.
  // A delayed save must never resolve the currently active tree after a switch.
  const editorTreeIdRef = useRef(currentTreeId);
  const editorMemberIdRef = useRef(member.id);
  const formDataRef = useRef(formData);
  const isDirtyRef = useRef(isDirty);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const newMemberCreatedRef = useRef(false);
  const latestSaveRevisionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const lastDuplicateSignatureRef = useRef<string | null>(null);

  formDataRef.current = formData;
  isDirtyRef.current = isDirty;

  useEffect(() => {
    newMemberCreatedRef.current = false;
    setFormData(member);
    setInitialData(member);
    setEvidenceBaseline(member);
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

  // Records content is lazy-mounted the first time its tab becomes active.
  // Deriving this from `activeTab` (rather than only the tab-click handler)
  // covers restores that land directly on Records — e.g. a page refresh, where
  // the persisted tab is selected but no click fires to trigger the mount.
  useEffect(() => {
    if (activeTab === "records") setRecordsMounted(true);
  }, [activeTab]);

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
      formData.parents.maternalParent !== initialData.parents.maternalParent;

    setIsDirty(dirty);
    onDirtyChange?.(dirty);
  }, [formData, initialData, onDirtyChange]);

  const eligibleParents = useMemo(() => {
    const excluded = getDescendants(member.id, members);
    excluded.add(member.id);
    return members.filter((m) => !excluded.has(m.id));
  }, [member.id, members]);

  const linkedGalleryImages = useMemo(
    () =>
      galleryImages.filter((image) =>
        image.linkedMemberIds.includes(member.id),
      ),
    [galleryImages, member.id],
  );

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

  // Only gallery-sourced crop inputs are blob: URLs (the file-upload path
  // reads a data: URL instead) — revoke those, and only those, once the crop
  // dialog no longer needs them.
  const releaseSelectedImage = (image: string | null) => {
    if (image?.startsWith("blob:")) URL.revokeObjectURL(image);
  };

  const handleSelectGalleryImage = async (image: GalleryImage) => {
    try {
      const objectUrl = await fetchMediaObjectUrl(image.imageData);
      setSelectedImage(objectUrl);
    } catch {
      toast.error(t("toast-error-file"));
    }
  };

  const handlePickGalleryImage = (image: GalleryImage) => {
    setGalleryPickerOpen(false);
    void handleSelectGalleryImage(image);
  };

  const onConfirm = (imageData: string) => {
    handleChange("imageData", imageData);
    releaseSelectedImage(selectedImage);
    setSelectedImage(null);
  };

  const onCancelCrop = () => {
    releaseSelectedImage(selectedImage);
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

      setSaveStatus("saving");
      try {
        if (isNew) {
          if (!newMemberCreatedRef.current) {
            await onSaved?.(snapshot);
            newMemberCreatedRef.current = true;
          }
          return true;
        }
        const workspaceId = editorTreeIdRef.current;
        if (!workspaceId) return false;
        await updateMemberPartial(
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
          },
          workspaceId,
        );
        if (!opts?.autosave && isCurrent()) {
          toast.success(t("toast-success"));
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
    `member-edit-${formId}`,
    isNew && isDirty,
    useCallback(() => save(), [save]),
  );

  /** An input with the evidence for its field next to it. */
  const withEvidence = (field: CitableField, input: ReactNode) =>
    showEvidence ? (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{input}</div>
        <FieldEvidence member={member} field={field} variant="input" />
      </div>
    ) : (
      input
    );

  /** Ask what to do with a field's evidence once its value changes. */
  const evidenceWarning = (field: CitableField) =>
    showEvidence ? (
      <EvidenceChangeWarning
        memberId={member.id}
        field={field}
        baseline={citableFieldValue(evidenceBaseline, field)}
        value={citableFieldValue(formData, field)}
        onUndo={() =>
          setFormData((prev) =>
            withCitableFieldValue(
              prev,
              field,
              citableFieldValue(evidenceBaseline, field),
            ),
          )
        }
      />
    ) : null;

  const avatarImage =
    formData.imageData && galleryEnabled ? (
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
    );
  const avatarOverlayClassName =
    "absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer";
  const showGalleryPicker =
    !isNew && galleryEnabled && linkedGalleryImages.length > 0;

  return (
    <form
      id={formId}
      data-save-shortcut
      onSubmit={handleSave}
      className="flex flex-col"
    >
      <div className="nodrag">
        <div className="relative mb-4 w-fit mx-auto group">
          {avatarImage}
          {!canEditPhotos ? null : showGalleryPicker ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("avatar-change")}
                  className={avatarOverlayClassName}
                >
                  <Upload className="text-white w-6 h-6" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={handleSelectImage}>
                  <Upload className="size-4" />
                  {t("avatar-menu-upload")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGalleryPickerOpen(true)}>
                  <Images className="size-4" />
                  {t("avatar-menu-choose-gallery")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              aria-label={t("avatar-change")}
              className={avatarOverlayClassName}
              onClick={handleSelectImage}
            >
              <Upload className="text-white w-6 h-6" />
            </button>
          )}
        </div>
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
          onCancel={onCancelCrop}
        />
        <GalleryPickerDialog
          isOpen={galleryPickerOpen}
          images={linkedGalleryImages}
          onSelect={handlePickGalleryImage}
          onClose={() => setGalleryPickerOpen(false)}
        />

        <Tabs
          value={
            isNew && (activeTab === "relations" || activeTab === "records")
              ? "identity"
              : activeTab
          }
          onValueChange={(v) => onTabChange(v as MemberSheetTab)}
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
                <FieldLabel
                  htmlFor={fieldId("academicTitle")}
                  className="text-[12px] font-semibold text-muted-foreground uppercase"
                >
                  {t("academic-title-field")}
                </FieldLabel>
                <Input
                  size="sm"
                  id={fieldId("academicTitle")}
                  value={formData.academicTitle || ""}
                  className="shadow-none"
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
                  <ToggleGroupItem value="m" aria-label={t("gender-male")}>
                    <Mars />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="f" aria-label={t("gender-female")}>
                    <Venus />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="o" aria-label={t("gender-other")}>
                    <VenusAndMars />
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!errors.firstName}>
                  <FieldLabel
                    htmlFor={fieldId("firstName")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("firstname-field")}
                  </FieldLabel>
                  {withEvidence(
                    "first_name",
                    <Input
                      size="sm"
                      ref={firstNameRef}
                      id={fieldId("firstName")}
                      required
                      aria-required="true"
                      aria-invalid={!!errors.firstName}
                      aria-describedby={
                        errors.firstName
                          ? fieldId("firstName-error")
                          : undefined
                      }
                      value={formData.firstName}
                      className="shadow-none"
                      placeholder={t("firstname-placeholder")}
                      onChange={(e) => {
                        handleChange("firstName", e.target.value);
                        if (errors.firstName)
                          setErrors((p) => ({ ...p, firstName: undefined }));
                      }}
                    />,
                  )}
                  {evidenceWarning("first_name")}
                  <FieldError id={fieldId("firstName-error")}>
                    {errors.firstName}
                  </FieldError>
                </Field>

                <Field data-invalid={!!errors.lastName}>
                  <FieldLabel
                    htmlFor={fieldId("lastName")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("lastname-field")}
                  </FieldLabel>
                  {withEvidence(
                    "last_name",
                    <Input
                      size="sm"
                      ref={lastNameRef}
                      id={fieldId("lastName")}
                      required
                      aria-required="true"
                      aria-invalid={!!errors.lastName}
                      aria-describedby={
                        errors.lastName ? fieldId("lastName-error") : undefined
                      }
                      value={formData.lastName}
                      className="shadow-none"
                      placeholder={t("lastname-field")}
                      onChange={(e) => {
                        handleChange("lastName", e.target.value);
                        if (errors.lastName)
                          setErrors((p) => ({ ...p, lastName: undefined }));
                      }}
                    />,
                  )}
                  {evidenceWarning("last_name")}
                  <FieldError id={fieldId("lastName-error")}>
                    {errors.lastName}
                  </FieldError>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel
                    htmlFor={fieldId("middleNames")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("middle-names-field")}
                  </FieldLabel>
                  {withEvidence(
                    "middle_names",
                    <Input
                      size="sm"
                      id={fieldId("middleNames")}
                      value={formData.middleNames || ""}
                      className="shadow-none"
                      placeholder={t("middle-names-field")}
                      onChange={(e) =>
                        handleChange("middleNames", e.target.value)
                      }
                    />,
                  )}
                  {evidenceWarning("middle_names")}
                </Field>

                <Field>
                  <FieldLabel
                    htmlFor={fieldId("maidenName")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("maiden-field")}
                  </FieldLabel>
                  {withEvidence(
                    "maiden_name",
                    <Input
                      size="sm"
                      id={fieldId("maidenName")}
                      value={formData.maidenName || ""}
                      className="shadow-none"
                      placeholder={t("lastname-field")}
                      onChange={(e) =>
                        handleChange("maidenName", e.target.value)
                      }
                    />,
                  )}
                  {evidenceWarning("maiden_name")}
                </Field>
              </div>

              <Field>
                <FieldLabel
                  htmlFor={fieldId("baptismalName")}
                  className="text-[12px] font-semibold text-muted-foreground uppercase"
                >
                  {t("baptismal-name-field")}
                </FieldLabel>
                {withEvidence(
                  "baptismal_name",
                  <Input
                    size="sm"
                    id={fieldId("baptismalName")}
                    value={formData.baptismalName || ""}
                    className="shadow-none"
                    placeholder={t("baptismal-name-field")}
                    onChange={(e) =>
                      handleChange("baptismalName", e.target.value)
                    }
                  />,
                )}
                {evidenceWarning("baptismal_name")}
              </Field>
            </FieldGroup>

            {!isNew && (
              <div className="mt-4 pt-4 border-t">
                <IdentityLinksPanel member={member} />
              </div>
            )}
          </TabsContent>

          {/* Life tab */}
          <TabsContent value="life">
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("born-field")}
                  </FieldLabel>
                  {withEvidence(
                    "date_of_birth",
                    <PartialDatePicker
                      size="sm"
                      className="shadow-none border-input"
                      value={formData.date.birth}
                      onChange={(date) => handleDateChange("birth", date)}
                      placeholder={t("date-placeholder")}
                    />,
                  )}
                  {evidenceWarning("date_of_birth")}
                </Field>

                <Field>
                  <FieldLabel
                    htmlFor={fieldId("birthplace")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("birthplace-field")}
                  </FieldLabel>
                  {withEvidence(
                    "birthplace",
                    <LocationInput
                      id={fieldId("birthplace")}
                      value={formData.birthplace}
                      size="sm"
                      placeholder={t("location-placeholder")}
                      geocodeEnabled={mapEnabled}
                      onChange={(value) => handleChange("birthplace", value)}
                    />,
                  )}
                  {evidenceWarning("birthplace")}
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

              {formData.deceased && (
                <div className={mapEnabled ? "grid grid-cols-2 gap-3" : ""}>
                  <Field>
                    <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                      {t("death-field")}
                    </FieldLabel>
                    {withEvidence(
                      "date_of_death",
                      <PartialDatePicker
                        size="sm"
                        className="shadow-none border-input"
                        value={formData.date.death}
                        onChange={(date) => handleDateChange("death", date)}
                        placeholder={t("date-placeholder")}
                      />,
                    )}
                    {evidenceWarning("date_of_death")}
                  </Field>

                  {mapEnabled && (
                    <Field>
                      <FieldLabel
                        htmlFor={fieldId("cemetery")}
                        className="text-[12px] font-semibold text-muted-foreground uppercase"
                      >
                        {t("cemetery-field")}
                      </FieldLabel>
                      <LocationInput
                        id={fieldId("cemetery")}
                        value={formData.cemetery}
                        size="sm"
                        placeholder={t("location-placeholder")}
                        onChange={(value) => handleChange("cemetery", value)}
                      />
                    </Field>
                  )}
                </div>
              )}

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

              {mapEnabled && (
                <Field>
                  <FieldLabel
                    htmlFor={fieldId("hometown")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("hometown-field")}
                  </FieldLabel>
                  <LocationInput
                    id={fieldId("hometown")}
                    value={formData.hometown}
                    size="sm"
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
                          size="sm"
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
                            size="sm"
                            value={place.from || ""}
                            className="shadow-none"
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
                            size="sm"
                            value={place.to || ""}
                            className="shadow-none"
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
                  <FieldLabel
                    htmlFor={fieldId("additionalData")}
                    className="text-[12px] font-semibold text-muted-foreground uppercase"
                  >
                    {t("notes-field")}
                  </FieldLabel>
                  <MarkdownEditor
                    id={fieldId("additionalData")}
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
                  {tasksEnabled && <MemberTasks member={member} />}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </form>
  );
};
