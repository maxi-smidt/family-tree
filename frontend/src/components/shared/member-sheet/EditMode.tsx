import { Input } from "@/components/ui/input";
import { useMemberStore } from "@/hooks/useMemberStore";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Mars, Upload, User, Venus, VenusAndMars } from "lucide-react";
import { Gender, Member } from "@/types/member";
import { DatePicker } from "@/components/ui/date-picker";
import { ImageCropDialog } from "@/components/shared/member-sheet/dialog/ImageCropDialog";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useTranslation } from "react-i18next";
import { MemberEvents } from "./MemberEvents";
import { MemberStories } from "./MemberStories";
import { MemberDiseases } from "./MemberDiseases";

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

  const [formData, setFormData] = useState<Member>(member);
  const [initialData, setInitialData] = useState<Member>(member);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFormData(member);
    setInitialData(member);
    onDirtyChange?.(false);
  }, [member]);

  useEffect(() => {
    const isDirty =
      formData.firstName !== initialData.firstName ||
      formData.lastName !== initialData.lastName ||
      (formData.maidenName || "") !== (initialData.maidenName || "") ||
      formData.gender !== initialData.gender ||
      (formData.imageData || "") !== (initialData.imageData || "") ||
      formData.date.birth !== initialData.date.birth ||
      (formData.date.death || "") !== (initialData.date.death || "");

    onDirtyChange?.(isDirty);
  }, [formData, initialData, onDirtyChange]);

  const handleChange = (field: keyof Member, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  function handleSelectImage() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
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

  const parseDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return undefined;
    return new Date(dateStr);
  };

  const handleDateChange = (
    field: "birth" | "death",
    date: Date | undefined,
  ) => {
    let dateString = null;

    if (date) {
      const offsetMs = date.getTimezoneOffset() * 60 * 1000;
      const localISODate = new Date(date.getTime() - offsetMs);
      dateString = localISODate.toISOString().split("T")[0];
    }

    if (field === "death" && dateString && formData.date.birth) {
      const birthDate = new Date(formData.date.birth);
      const deathDate = new Date(dateString);
      if (deathDate < birthDate) {
        toast.error(t("toast-error-death"));
        return;
      }
    }

    if (field === "birth" && dateString && formData.date.death) {
      const birthDate = new Date(dateString);
      const deathDate = new Date(formData.date.death);
      if (deathDate < birthDate) {
        toast.error(t("toast-error-birth"));
        return;
      }
    }

    setFormData((prev) => ({
      ...prev,
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

    void updateMemberPartial(member.id, {
      firstName: formData.firstName,
      lastName: formData.lastName,
      // Send null (not undefined) when cleared so the backend actually clears
      // the column — undefined is dropped from the JSON body and ignored.
      maidenName: formData.maidenName || null,
      gender: formData.gender,
      imageData: formData.imageData || undefined,
      dateOfBirth: formData.date.birth,
      dateOfDeath: formData.date.death || null,
    });
    toast.success(t("toast-success"));
    onSaved?.(formData);
  };

  return (
    <form id="edit-member-form" onSubmit={handleSave} className="flex flex-col">
      <div className="flex flex-col gap-1 w-full nodrag">
        <label className="block relative mb-2 cursor-pointer group w-fit mx-auto">
          {formData.imageData ? (
            <img
              src={formData.imageData}
              className="size-32 rounded-full object-cover mx-auto bg-gray-100"
              alt="Profile"
            />
          ) : (
            <div className="size-32 flex justify-center items-center rounded-full mx-auto bg-gray-200 text-2xl font-bold text-gray-500">
              <User size={64} />
            </div>
          )}

          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleSelectImage}
          >
            <Upload className="text-white w-8 h-8" />
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

        <FieldGroup className="gap-4">
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

          <Field>
            <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
              {t("born-field")}
            </FieldLabel>
            <DatePicker
              className="h-7 text-xs shadow-none border-input"
              value={parseDate(formData.date.birth)}
              onChange={(date) => handleDateChange("birth", date)}
              placeholder={t("date-placeholder")}
            />
          </Field>

          <Field>
            <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
              {t("death-field")}
            </FieldLabel>
            <DatePicker
              className="h-7 text-xs shadow-none border-input"
              value={parseDate(formData.date.death)}
              onChange={(date) => handleDateChange("death", date)}
              placeholder={t("date-placeholder")}
            />
          </Field>
        </FieldGroup>

        <div className="space-y-4 mt-6">
          <MemberEvents member={member} />
          <MemberStories member={member} />
          <MemberDiseases member={member} />
        </div>
      </div>
    </form>
  );
};
