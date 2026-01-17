import { Input } from "@/components/ui/input";
import { useFamilyStore } from "@/hooks/useFamilyStore.ts";
import { ChangeEvent, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Member } from "@/types/member.ts";
import { DatePicker } from "@/components/ui/date-picker.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ImageCropDialog } from "@/components/dialog/ImageCropDialog.tsx";

type Props = {
  member: Member;
};

export const EditFamilyNode = ({ member }: Props) => {
  const { updateMemberPartial } = useFamilyStore();

  const [formData, setFormData] = useState<Member>(member);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    setFormData(member);
  }, [member]);

  const handleChange = (field: keyof Member, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field: keyof Member) => {
    void updateMemberPartial(member.id, { [field]: formData[field] });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      setSelectedImage(base64String);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const onConfirm = (imageData: string) => {
    handleChange("imageData", imageData);
    void updateMemberPartial(member.id, { imageData: imageData });
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
    const dateString = date ? date.toISOString().split("T")[0] : null;

    setFormData((prev) => ({
      ...prev,
      date: {
        ...prev.date,
        [field]: dateString,
      },
    }));

    const updateField = field === "birth" ? "dateOfBirth" : "dateOfDeath";
    void updateMemberPartial(member.id, {
      [updateField]: dateString,
    });
  };

  return (
    <div className="flex flex-col gap-1 w-full nodrag">
      <label className="block relative mb-2 cursor-pointer group w-fit mx-auto">
        {formData.imageData ? (
          <img
            src={formData.imageData}
            className="size-16 rounded-full object-cover mx-auto bg-gray-100"
            alt="Profile"
          />
        ) : (
          <div className="size-16 flex justify-center items-center rounded-full mx-auto bg-gray-200 text-2xl font-bold text-gray-500">
            ?
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
          <Upload className="text-white w-5 h-5" />
        </div>

        <input
          type="file"
          className="hidden"
          accept="image/*"
          onChange={handleFileChange}
        />
      </label>
      <ImageCropDialog
        isOpen={!!selectedImage}
        imageData={selectedImage}
        onConfirm={onConfirm}
        onCancel={() => setSelectedImage(null)}
      />

      <div className="grid grid-cols-[50px_1fr] gap-y-2 items-center">
        <label className="text-[10px] font-semibold text-muted-foreground text-left">
          FIRST
        </label>
        <Input
          id="firstName"
          value={formData.firstName}
          className="h-7 text-xs! shadow-none"
          onChange={(e) => handleChange("firstName", e.target.value)}
          onBlur={() => handleBlur("firstName")}
        />

        <label className="text-[10px] font-semibold text-muted-foreground text-left">
          LAST
        </label>
        <Input
          id="lastName"
          value={formData.lastName}
          className="h-7 text-xs! shadow-none"
          onChange={(e) => handleChange("lastName", e.target.value)}
          onBlur={() => handleBlur("lastName")}
        />

        <label className="text-[10px] font-semibold text-muted-foreground text-left">
          BORN
        </label>
        <DatePicker
          className="h-7 text-xs shadow-none border-input"
          value={parseDate(formData.date.birth)}
          onChange={(date) => handleDateChange("birth", date)}
        />

        <label className="text-[10px] font-semibold text-muted-foreground text-left">
          DIED
        </label>
        <DatePicker
          className="h-7 text-xs shadow-none border-input"
          value={parseDate(formData.date.death)}
          onChange={(date) => handleDateChange("death", date)}
        />

        <label className="text-[10px] font-semibold text-muted-foreground text-left">
          EXTRA
        </label>
        <Textarea
          className="text-xs! shadow-none"
          placeholder="Additional Information"
          onChange={(e) => handleChange("additionalData", e.target.value)}
          onBlur={() => handleBlur("additionalData")}
        />
      </div>
    </div>
  );
};
