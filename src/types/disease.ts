export type CarrierStatus = "affected" | "carrier" | "unknown";

export interface Disease {
  id: string;
  name: string;
  carrierStatus: CarrierStatus;
  diagnosisDate: string | null;
  notes: string | null;
}

export interface DiseaseDB {
  id: string;
  member_id: string;
  name: string;
  carrier_status: string;
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

  return {
    id: row.id,
    name: row.name,
    carrierStatus: carrierStatus,
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
    diagnosis_date: disease.diagnosisDate,
    notes: disease.notes,
  };
}
