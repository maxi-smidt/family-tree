export type CarrierStatus = "affected" | "carrier" | "unknown";
export type InheritancePattern =
  | "autosomal_dominant"
  | "autosomal_recessive"
  | "x_linked_dominant"
  | "x_linked_recessive"
  | "y_linked"
  | "mitochondrial"
  | "multifactorial"
  | "unknown";

export interface Disease {
  id: string;
  name: string;
  carrierStatus: CarrierStatus;
  inheritancePattern: InheritancePattern;
  diagnosisDate: string | null;
  notes: string | null;
}

export interface DiseaseDB {
  id: string;
  member_id: string;
  name: string;
  carrier_status: string;
  inheritance_pattern: string;
  diagnosis_date: string | null;
  notes: string | null;
}

export function mapDiseaseFromDB(row: DiseaseDB): Disease {
  const validStatuses: CarrierStatus[] = ["affected", "carrier", "unknown"];
  const carrierStatus = validStatuses.includes(
    row.carrier_status as CarrierStatus,
  )
    ? (row.carrier_status as CarrierStatus)
    : "unknown";

  const validPatterns: InheritancePattern[] = [
    "autosomal_dominant",
    "autosomal_recessive",
    "x_linked_dominant",
    "x_linked_recessive",
    "y_linked",
    "mitochondrial",
    "multifactorial",
    "unknown",
  ];
  const inheritancePattern = validPatterns.includes(
    row.inheritance_pattern as InheritancePattern,
  )
    ? (row.inheritance_pattern as InheritancePattern)
    : "unknown";

  return {
    id: row.id,
    name: row.name,
    carrierStatus: carrierStatus,
    inheritancePattern: inheritancePattern,
    diagnosisDate: row.diagnosis_date,
    notes: row.notes,
  };
}

export function mapDiseaseToDB(disease: Disease, memberId: string): DiseaseDB {
  return {
    id: disease.id,
    member_id: memberId,
    name: disease.name,
    carrier_status: disease.carrierStatus,
    inheritance_pattern: disease.inheritancePattern,
    diagnosis_date: disease.diagnosisDate,
    notes: disease.notes,
  };
}
