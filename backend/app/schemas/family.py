"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged."""

from pydantic import BaseModel, ConfigDict


# --- Members ---------------------------------------------------------------
class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    gender: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    additionalData: str | None = None
    isCollapsed: bool = False
    positionX: float = 0
    positionY: float = 0


class MemberCreate(BaseModel):
    id: str
    gender: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    additionalData: str | None = None
    isCollapsed: bool = False
    positionX: float = 0
    positionY: float = 0


class MemberUpdate(BaseModel):
    gender: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    additionalData: str | None = None
    isCollapsed: bool | None = None
    positionX: float | None = None
    positionY: float | None = None


class MemberPositionUpdate(BaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    positionX: float
    positionY: float


# --- Relations -------------------------------------------------------------
class RelationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_member_id: str
    to_member_id: str
    relation_type: str


class RelationCreate(BaseModel):
    from_member_id: str
    to_member_id: str
    relation_type: str


# --- Relation types --------------------------------------------------------
class RelationTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str


class RelationTypeCreate(BaseModel):
    id: str
    description: str | None = None


# --- Diseases --------------------------------------------------------------
class DiseaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    member_id: str
    name: str
    carrier_status: str
    inheritance_pattern: str
    diagnosis_date: str | None = None
    notes: str | None = None


class DiseaseCreate(BaseModel):
    id: str
    member_id: str
    name: str
    carrier_status: str
    inheritance_pattern: str = "unknown"
    diagnosis_date: str | None = None
    notes: str | None = None


class DiseaseUpdate(BaseModel):
    name: str
    carrier_status: str
    inheritance_pattern: str
    diagnosis_date: str | None = None
    notes: str | None = None
