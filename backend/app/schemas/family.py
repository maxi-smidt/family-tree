"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged.

DB columns are snake_case; `MemberOut`/`MemberCreate` and related member schemas
expose camelCase automatically via the ``CamelCaseModel`` /
``CamelCaseOrmModel`` alias-generator base classes.  Relation, disease, and
other schemas intentionally stay snake_case because the frontend reads them
as-is.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import CamelCaseModel, CamelCaseOrmModel


# --- Members ---------------------------------------------------------------
class MemberOut(CamelCaseOrmModel):
    id: str
    gender: str | None = None
    academic_title: str | None = None
    first_name: str | None = None
    middle_names: str | None = None
    baptismal_name: str | None = None
    last_name: str | None = None
    maiden_name: str | None = None
    image_data: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    date_of_birth_sort: str | None = None
    date_of_death_sort: str | None = None
    deceased: bool = False
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = None
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberSurfaceOut(CamelCaseOrmModel):
    id: str
    gender: str | None = None
    academic_title: str | None = None
    first_name: str | None = None
    middle_names: str | None = None
    baptismal_name: str | None = None
    last_name: str | None = None
    maiden_name: str | None = None
    image_data: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    date_of_birth_sort: str | None = None
    date_of_death_sort: str | None = None
    deceased: bool = False
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberCreate(CamelCaseModel):
    id: str
    gender: str | None = None
    academic_title: str | None = None
    first_name: str | None = None
    middle_names: str | None = None
    baptismal_name: str | None = None
    last_name: str | None = None
    maiden_name: str | None = None
    image_data: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    deceased: bool = False
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = None
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberUpdate(CamelCaseModel):
    gender: str | None = None
    academic_title: str | None = None
    first_name: str | None = None
    middle_names: str | None = None
    baptismal_name: str | None = None
    last_name: str | None = None
    maiden_name: str | None = None
    image_data: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    deceased: bool | None = None
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = None
    is_collapsed: bool | None = None
    position_x: float | None = None
    position_y: float | None = None


class MemberPositionUpdate(CamelCaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    position_x: float
    position_y: float


class MemberCollapsedUpdate(CamelCaseModel):
    """One entry in a bulk collapsed-state update (expand-all / collapse-selected)."""

    id: str
    is_collapsed: bool


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
