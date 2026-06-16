"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged."""

from pydantic import BaseModel, ConfigDict, Field


# --- Members ---------------------------------------------------------------
class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    gender: str | None = None
    academicTitle: str | None = None
    firstName: str | None = None
    middleNames: str | None = None
    baptismalName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    deceased: bool = False
    additionalData: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    placesLived: str | None = None
    isCollapsed: bool = False
    positionX: float = 0
    positionY: float = 0


class MemberSurfaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    gender: str | None = None
    academicTitle: str | None = None
    firstName: str | None = None
    middleNames: str | None = None
    baptismalName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    deceased: bool = False
    isCollapsed: bool = False
    positionX: float = 0
    positionY: float = 0


class MemberCreate(BaseModel):
    id: str
    gender: str | None = None
    academicTitle: str | None = None
    firstName: str | None = None
    middleNames: str | None = None
    baptismalName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    deceased: bool = False
    additionalData: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    placesLived: str | None = None
    isCollapsed: bool = False
    positionX: float = 0
    positionY: float = 0


class MemberUpdate(BaseModel):
    gender: str | None = None
    academicTitle: str | None = None
    firstName: str | None = None
    middleNames: str | None = None
    baptismalName: str | None = None
    lastName: str | None = None
    maidenName: str | None = None
    imageData: str | None = None
    dateOfBirth: str | None = None
    dateOfDeath: str | None = None
    deceased: bool | None = None
    additionalData: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    placesLived: str | None = None
    isCollapsed: bool | None = None
    positionX: float | None = None
    positionY: float | None = None


class MemberPositionUpdate(BaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    positionX: float
    positionY: float


class MemberCollapsedUpdate(BaseModel):
    """One entry in a bulk collapsed-state update (expand-all / collapse-selected)."""

    id: str
    isCollapsed: bool


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
    description: str | None = None


class RelationTypeCreate(BaseModel):
    # Ids double as i18n key segments, so keep them URL- and i18next-safe.
    id: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    description: str | None = Field(default=None, max_length=255)


class RelationTypeUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=255)


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
