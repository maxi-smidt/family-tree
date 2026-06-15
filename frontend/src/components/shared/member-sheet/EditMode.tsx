import { Input } from "@/components/ui/input";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/services/api";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useFeature } from "@/hooks/useAuthStore";
import {
  ChangeEvent,
  FormEvent,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { useTranslation } from "react-i18next";
import { comparePartialDates } from "@/utils/dateUtils";
import { MemberEvents } from "./MemberEvents";
import { MemberStories } from "./MemberStories";
import { MemberDiseases } from "./MemberDiseases";
import { MemberSources } from "./MemberSources";
import { MemberPicker } from "./MemberPicker";
import { MemberPhotos } from "./MemberPhotos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

type Props = {
  member: Member;
  isNew?: boolean;
  onSaved?: (data: Member) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export const EditMode = ({
  member,
  isNew = false,
  onSaved,
  onDirtyChange,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode",
  });
  const { updateMemberPartial, members } = useMemberStore();
  const eventsEnabled = useFeature("events");
  const storiesEnabled = useFeature("stories");
  const sourcesEnabled = useFeature("sources");
  const galleryEnabled = useFeature("gallery");

  const [formData, setFormData] = useState<Member>(member);
  const [initialData, setInitialData] = useState<Member>(member);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [recordsMounted, setRecordsMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFormData(member);
    setInitialData(member);
    onDirtyChange?.(false);
  }, [member]);

  useEffect(() => {
    const isDirty =
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
      (formData.additionalData || "") !== (initialData.additionalData || "") ||
      (formData.birthplace || "") !== (initialData.birthplace || "") ||
      (formData.hometown || "") !== (initialData.hometown || "") ||
      JSON.stringify(formData.placesLived) !==
        JSON.stringify(initialData.placesLived) ||
      formData.parents.paternalParent !== initialData.parents.paternalParent ||
      formData.parents.maternalParent !== initialData.parents.maternalParent;

    onDirtyChange?.(isDirty);
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

  const handleSave = (e: FormEvent) => {
    e.preventDefault();

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error(t("toast-error-required"));
      return;
    }

    const duplicate = members.find(
      (m) =>
        m.id !== member.id &&
        m.firstName === formData.firstName &&
        (m.middleNames || "") === (formData.middleNames || "") &&
        (m.baptismalName || "") === (formData.baptismalName || "") &&
        m.lastName === formData.lastName &&
        m.gender === formData.gender &&
        m.date.birth === formData.date.birth &&
        m.date.death === formData.date.death,
    );

    if (duplicate) {
      toast.error(t("toast-error-duplicate"));
      return;
    }

    if (isNew) {
      onSaved?.(formData);
      return;
    }

    updateMemberPartial(member.id, {
      academicTitle: formData.academicTitle || null,
      firstName: formData.firstName,
      middleNames: formData.middleNames || null,
      baptismalName: formData.baptismalName || null,
      lastName: formData.lastName,
      maidenName: formData.maidenName || null,
      gender: formData.gender,
      imageData: formData.imageData || undefined,
      dateOfBirth: formData.date.birth,
      dateOfDeath: formData.date.death || null,
      deceased: formData.deceased,
      additionalData: formData.additionalData || null,
      birthplace: formData.birthplace || null,
      hometown: formData.hometown || null,
      placesLived:
        formData.placesLived.length > 0
          ? JSON.stringify(formData.placesLived)
          : null,
      paternalParentId: formData.parents.paternalParent,
      maternalParentId: formData.parents.maternalParent,
    })
      .then(() => {
        toast.success(t("toast-success"));
        onSaved?.(formData);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 413) {
          toast.error(t("toast-error-image-too-large"));
        } else if (err instanceof ApiError && err.status === 400) {
          toast.error(t("toast-error-image-unsupported"));
        } else {
          toast.error(t("toast-error-save"));
        }
      });
  };

  return (
    <form id="edit-member-form" onSubmit={handleSave} className="flex flex-col">
      <div className="nodrag">
        <label className="block relative mb-4 cursor-pointer group w-fit mx-auto">
          {formData.imageData ? (
            <AuthenticatedImage
              src={formData.imageData}
              className="size-24 rounded-full object-cover mx-auto bg-gray-100"
              alt="Profile"
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
          defaultValue="identity"
          onValueChange={(v) => {
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
                  onChange={(e) => handleChange("academicTitle", e.target.value)}
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
                    aria-label="Male"
                    className="h-7 min-w-7 text-xs"
                  >
                    <Mars />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="f"
                    aria-label="Female"
                    className="h-7 min-w-7 text-xs"
                  >
                    <Venus />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="o"
                    aria-label="Other"
                    className="h-7 min-w-7 text-xs"
                  >
                    <VenusAndMars />
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("firstname-field")}
                  </FieldLabel>
                  <Input
                    autoFocus
                    id="firstName"
                    value={formData.firstName}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("firstname-field")}
                    onChange={(e) => handleChange("firstName", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("lastname-field")}
                  </FieldLabel>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("lastname-field")}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                  />
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
                    onChange={(e) => handleChange("middleNames", e.target.value)}
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
                  <Input
                    id="birthplace"
                    value={formData.birthplace || ""}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("location-placeholder")}
                    onChange={(e) => handleChange("birthplace", e.target.value)}
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

              {formData.deceased && (
                <div className="grid grid-cols-2 gap-3">
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

                  <Field>
                    <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                      {t("hometown-field")}
                    </FieldLabel>
                    <Input
                      id="hometown"
                      value={formData.hometown || ""}
                      className="h-7 text-xs! shadow-none"
                      placeholder={t("location-placeholder")}
                      onChange={(e) => handleChange("hometown", e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {!formData.deceased && (
                <Field>
                  <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                    {t("hometown-field")}
                  </FieldLabel>
                  <Input
                    id="hometown"
                    value={formData.hometown || ""}
                    className="h-7 text-xs! shadow-none"
                    placeholder={t("location-placeholder")}
                    onChange={(e) => handleChange("hometown", e.target.value)}
                  />
                </Field>
              )}

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
                      className="flex flex-col gap-1 border rounded p-2"
                    >
                      <div className="flex items-center gap-1">
                        <Input
                          value={place.location}
                          className="h-7 text-xs! shadow-none flex-1"
                          placeholder={t("location-placeholder")}
                          onChange={(e) => {
                            const next = formData.placesLived.map((p, i) =>
                              i === idx
                                ? { ...p, location: e.target.value }
                                : p,
                            );
                            handleChange("placesLived", next);
                          }}
                        />
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => {
                            handleChange(
                              "placesLived",
                              formData.placesLived.filter((_, i) => i !== idx),
                            );
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
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

              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("notes-field")}
                </FieldLabel>
                <Textarea
                  id="additionalData"
                  value={formData.additionalData || ""}
                  className="text-xs! shadow-none resize-none"
                  rows={4}
                  placeholder={t("notes-placeholder")}
                  onChange={(e) =>
                    handleChange("additionalData", e.target.value)
                  }
                />
              </Field>
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
                  {sourcesEnabled && <MemberSources member={member} />}
                  <MemberDiseases member={member} />
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </form>
  );
};
