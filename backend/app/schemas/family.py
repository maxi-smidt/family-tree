"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged.

The API speaks snake_case end to end: the DB columns are snake_case and the
schemas expose the same field names verbatim (no camelCase aliases).  Output
schemas use ``from_attributes=True`` so they can be built straight from ORM
objects.
"""

from pydantic import BaseModel, ConfigDict, Field


# --- Members ---------------------------------------------------------------
class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class MemberSurfaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class MemberCreate(BaseModel):
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


class MemberUpdate(BaseModel):
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


class MemberPositionUpdate(BaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    position_x: float
    position_y: float


class MemberCollapsedUpdate(BaseModel):
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
