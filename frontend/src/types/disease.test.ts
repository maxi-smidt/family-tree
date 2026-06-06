import { describe, it, expect } from "vitest";
import {
  mapDiseaseFromDB,
  mapDiseaseToDB,
  DiseaseDB,
  Disease,
} from "./disease";

describe("mapDiseaseFromDB", () => {
  it("should correctly map a database disease to a domain disease", () => {
    const dbDisease: DiseaseDB = {
      id: "1",
      member_id: "member-1",
      name: "Hemophilia A",
      carrier_status: "affected",
      inheritance_pattern: "x_linked_recessive",
      diagnosis_date: "2020-01-15",
      notes: "Type A variant",
    };

    const result = mapDiseaseFromDB(dbDisease);

    expect(result.id).toBe("1");
    expect(result.name).toBe("Hemophilia A");
    expect(result.carrierStatus).toBe("affected");
    expect(result.inheritancePattern).toBe("x_linked_recessive");
    expect(result.diagnosisDate).toBe("2020-01-15");
    expect(result.notes).toBe("Type A variant");
  });

  it("should handle null diagnosis date and notes", () => {
    const dbDisease: DiseaseDB = {
      id: "2",
      member_id: "member-2",
      name: "Cystic Fibrosis",
      carrier_status: "carrier",
      inheritance_pattern: "autosomal_recessive",
      diagnosis_date: null,
      notes: null,
    };

    const result = mapDiseaseFromDB(dbDisease);

    expect(result.diagnosisDate).toBeNull();
    expect(result.notes).toBeNull();
  });

  it("should default to unknown carrier status if invalid", () => {
    const dbDisease: DiseaseDB = {
      id: "3",
      member_id: "member-3",
      name: "Sickle Cell Disease",
      carrier_status: "invalid" as any,
      inheritance_pattern: "autosomal_recessive",
      diagnosis_date: null,
      notes: null,
    };

    const result = mapDiseaseFromDB(dbDisease);

    expect(result.carrierStatus).toBe("unknown");
  });

  it("should default to unknown inheritance pattern if invalid", () => {
    const dbDisease: DiseaseDB = {
      id: "4",
      member_id: "member-4",
      name: "Test Disease",
      carrier_status: "affected",
      inheritance_pattern: "invalid_pattern" as any,
      diagnosis_date: null,
      notes: null,
    };

    const result = mapDiseaseFromDB(dbDisease);

    expect(result.inheritancePattern).toBe("unknown");
  });
});

describe("mapDiseaseToDB", () => {
  it("should correctly map a domain disease to a database disease", () => {
    const disease: Disease = {
      id: "1",
      name: "Thalassemia",
      carrierStatus: "carrier",
      inheritancePattern: "autosomal_recessive",
      diagnosisDate: "2019-05-20",
      notes: "Beta thalassemia minor",
    };

    const result = mapDiseaseToDB(disease, "member-1");

    expect(result.id).toBe("1");
    expect(result.member_id).toBe("member-1");
    expect(result.name).toBe("Thalassemia");
    expect(result.carrier_status).toBe("carrier");
    expect(result.inheritance_pattern).toBe("autosomal_recessive");
    expect(result.diagnosis_date).toBe("2019-05-20");
    expect(result.notes).toBe("Beta thalassemia minor");
  });

  it("should handle null values", () => {
    const disease: Disease = {
      id: "2",
      name: "Huntington's Disease",
      carrierStatus: "affected",
      inheritancePattern: "autosomal_dominant",
      diagnosisDate: null,
      notes: null,
    };

    const result = mapDiseaseToDB(disease, "member-2");

    expect(result.diagnosis_date).toBeNull();
    expect(result.notes).toBeNull();
  });
});
