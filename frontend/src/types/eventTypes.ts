import {
  Baby,
  Droplets,
  Heart,
  HeartCrack,
  Plane,
  Briefcase,
  GraduationCap,
  Shield,
  Flower2,
  Mountain,
  Tag,
  type LucideIcon,
} from "lucide-react";

export interface EventTypeOption {
  value: string;
  labelKey: string;
  icon: LucideIcon;
}

export const PREDEFINED_EVENT_TYPES: EventTypeOption[] = [
  { value: "birth", labelKey: "birth", icon: Baby },
  { value: "baptism", labelKey: "baptism", icon: Droplets },
  { value: "marriage", labelKey: "marriage", icon: Heart },
  { value: "divorce", labelKey: "divorce", icon: HeartCrack },
  { value: "immigration", labelKey: "immigration", icon: Plane },
  { value: "occupation", labelKey: "occupation", icon: Briefcase },
  { value: "education", labelKey: "education", icon: GraduationCap },
  { value: "military", labelKey: "military", icon: Shield },
  { value: "death", labelKey: "death", icon: Flower2 },
  { value: "burial", labelKey: "burial", icon: Mountain },
];

export const CUSTOM_EVENT_TYPE = "custom";
export const CUSTOM_ICON: LucideIcon = Tag;

export function getEventTypeInfo(eventType: string): {
  icon: LucideIcon;
  isPredefined: boolean;
  predefined?: EventTypeOption;
} {
  const lower = eventType.toLowerCase();
  const predefined = PREDEFINED_EVENT_TYPES.find((t) => t.value === lower);
  if (predefined) {
    return { icon: predefined.icon, isPredefined: true, predefined };
  }
  return { icon: CUSTOM_ICON, isPredefined: false };
}

export function getEventTypeLabel(
  eventType: string,
  t: (key: string) => string,
): string {
  const { isPredefined, predefined } = getEventTypeInfo(eventType);
  if (isPredefined && predefined) {
    return t(`event-types.${predefined.labelKey}`);
  }
  return eventType;
}
