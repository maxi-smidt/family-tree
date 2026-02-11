import { Input } from "@/components/ui/input";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useEffect, useState } from "react";
import { Mars, Upload, User, Venus, VenusAndMars } from "lucide-react";
import { Gender, Member } from "@/types/member";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { ImageCropDialog } from "@/components/dialog/ImageCropDialog";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

type Props = {
  member: Member;
};

export const EditMode = ({ member }: Props) => {
  const { updateMemberPartial } = useFamilyStore();

  const [formData, setFormData] = useState<Member>(member);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    setFormData(member);
  }, [member]);

  const handleChange = (field: keyof Member, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  async function handleSelectImage() {
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "svg"],
        },
      ],
    });

    if (!filePath) return;

    try {
      const fileBytes = await readFile(filePath);
      const blob = new Blob([fileBytes]);
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64String = event.target?.result as string;
        setSelectedImage(base64String);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      toast.error("Failed to read file");
    }
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
        toast.error("Death date cannot be before birth date");
        return;
      }
    }

    if (field === "birth" && dateString && formData.date.death) {
      const birthDate = new Date(dateString);
      const deathDate = new Date(formData.date.death);
      if (deathDate < birthDate) {
        toast.error("Birth date cannot be after death date");
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

  const handleSave = () => {
    void updateMemberPartial(member.id, {
      firstName: formData.firstName,
      lastName: formData.lastName,
      maidenName: formData.maidenName || undefined,
      gender: formData.gender,
      imageData: formData.imageData || undefined,
      dateOfBirth: formData.date.birth,
      dateOfDeath: formData.date.death || undefined,
      additionalData: formData.additionalData || undefined,
    });
    toast.success("Member updated successfully");
  };

  return (
    <>
      <div className="px-4 pb-2 flex-1 overflow-y-auto flex flex-col">
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
          <ImageCropDialog
            isOpen={!!selectedImage}
            imageData={selectedImage}
            onConfirm={onConfirm}
            onCancel={() => setSelectedImage(null)}
          />

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Gender
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
                  value="male"
                  aria-label="Male"
                  className="h-7 min-w-7 text-xs"
                >
                  <Mars />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="female"
                  aria-label="Female"
                  className="h-7 min-w-7 text-xs"
                >
                  <Venus />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="other"
                  aria-label="Other"
                  className="h-7 min-w-7 text-xs"
                >
                  <VenusAndMars />
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                First
              </FieldLabel>
              <Input
                id="firstName"
                value={formData.firstName}
                className="h-7 text-xs! shadow-none"
                placeholder="First Name"
                onChange={(e) => handleChange("firstName", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Last
              </FieldLabel>
              <Input
                id="lastName"
                value={formData.lastName}
                className="h-7 text-xs! shadow-none"
                placeholder="Last Name"
                onChange={(e) => handleChange("lastName", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Maiden
              </FieldLabel>
              <Input
                id="maidenName"
                value={formData.maidenName || ""}
                className="h-7 text-xs! shadow-none"
                placeholder="Maiden Name"
                onChange={(e) => handleChange("maidenName", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Born
              </FieldLabel>
              <DatePicker
                className="h-7 text-xs shadow-none border-input"
                value={parseDate(formData.date.birth)}
                onChange={(date) => handleDateChange("birth", date)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Died
              </FieldLabel>
              <DatePicker
                className="h-7 text-xs shadow-none border-input"
                value={parseDate(formData.date.death)}
                onChange={(date) => handleDateChange("death", date)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                Extra
              </FieldLabel>
              <Textarea
                className="text-xs! shadow-none"
                placeholder="Additional Information"
                value={formData.additionalData || ""}
                onChange={(e) => handleChange("additionalData", e.target.value)}
              />
            </Field>
          </FieldGroup>
        </div>
      </div>
      <SheetFooter className="mt-auto p-4 border-t bg-background">
        <Button onClick={handleSave} className="w-full" size="sm">
          Save Changes
        </Button>
      </SheetFooter>
    </>
  );
};
