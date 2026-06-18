"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged.

The DB columns are now snake_case; camelCase is preserved at the API boundary
via Pydantic ``Field(alias=...)`` / ``serialization_alias``.  All schemas that
are populated from ORM objects use ``from_attributes=True`` and
``populate_by_name=True`` so both the snake_case attribute name and the
camelCase alias work as input keys.
"""

from pydantic import BaseModel, ConfigDict, Field


# --- Members ---------------------------------------------------------------
class MemberOut(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
    )

    id: str
    gender: str | None = None
    academic_title: str | None = Field(default=None, serialization_alias="academicTitle")
    first_name: str | None = Field(default=None, serialization_alias="firstName")
    middle_names: str | None = Field(default=None, serialization_alias="middleNames")
    baptismal_name: str | None = Field(default=None, serialization_alias="baptismalName")
    last_name: str | None = Field(default=None, serialization_alias="lastName")
    maiden_name: str | None = Field(default=None, serialization_alias="maidenName")
    image_data: str | None = Field(default=None, serialization_alias="imageData")
    date_of_birth: str | None = Field(default=None, serialization_alias="dateOfBirth")
    date_of_death: str | None = Field(default=None, serialization_alias="dateOfDeath")
    date_of_birth_sort: str | None = Field(
        default=None, serialization_alias="dateOfBirthSort"
    )
    date_of_death_sort: str | None = Field(
        default=None, serialization_alias="dateOfDeathSort"
    )
    deceased: bool = False
    additional_data: str | None = Field(
        default=None, serialization_alias="additionalData"
    )
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = Field(default=None, serialization_alias="placesLived")
    is_collapsed: bool = Field(default=False, serialization_alias="isCollapsed")
    position_x: float = Field(default=0, serialization_alias="positionX")
    position_y: float = Field(default=0, serialization_alias="positionY")


class MemberSurfaceOut(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
    )

    id: str
    gender: str | None = None
    academic_title: str | None = Field(default=None, serialization_alias="academicTitle")
    first_name: str | None = Field(default=None, serialization_alias="firstName")
    middle_names: str | None = Field(default=None, serialization_alias="middleNames")
    baptismal_name: str | None = Field(default=None, serialization_alias="baptismalName")
    last_name: str | None = Field(default=None, serialization_alias="lastName")
    maiden_name: str | None = Field(default=None, serialization_alias="maidenName")
    image_data: str | None = Field(default=None, serialization_alias="imageData")
    date_of_birth: str | None = Field(default=None, serialization_alias="dateOfBirth")
    date_of_death: str | None = Field(default=None, serialization_alias="dateOfDeath")
    date_of_birth_sort: str | None = Field(
        default=None, serialization_alias="dateOfBirthSort"
    )
    date_of_death_sort: str | None = Field(
        default=None, serialization_alias="dateOfDeathSort"
    )
    deceased: bool = False
    is_collapsed: bool = Field(default=False, serialization_alias="isCollapsed")
    position_x: float = Field(default=0, serialization_alias="positionX")
    position_y: float = Field(default=0, serialization_alias="positionY")


class MemberCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    gender: str | None = None
    academic_title: str | None = Field(default=None, alias="academicTitle")
    first_name: str | None = Field(default=None, alias="firstName")
    middle_names: str | None = Field(default=None, alias="middleNames")
    baptismal_name: str | None = Field(default=None, alias="baptismalName")
    last_name: str | None = Field(default=None, alias="lastName")
    maiden_name: str | None = Field(default=None, alias="maidenName")
    image_data: str | None = Field(default=None, alias="imageData")
    date_of_birth: str | None = Field(default=None, alias="dateOfBirth")
    date_of_death: str | None = Field(default=None, alias="dateOfDeath")
    deceased: bool = False
    additional_data: str | None = Field(default=None, alias="additionalData")
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = Field(default=None, alias="placesLived")
    is_collapsed: bool = Field(default=False, alias="isCollapsed")
    position_x: float = Field(default=0, alias="positionX")
    position_y: float = Field(default=0, alias="positionY")


class MemberUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    gender: str | None = None
    academic_title: str | None = Field(default=None, alias="academicTitle")
    first_name: str | None = Field(default=None, alias="firstName")
    middle_names: str | None = Field(default=None, alias="middleNames")
    baptismal_name: str | None = Field(default=None, alias="baptismalName")
    last_name: str | None = Field(default=None, alias="lastName")
    maiden_name: str | None = Field(default=None, alias="maidenName")
    image_data: str | None = Field(default=None, alias="imageData")
    date_of_birth: str | None = Field(default=None, alias="dateOfBirth")
    date_of_death: str | None = Field(default=None, alias="dateOfDeath")
    deceased: bool | None = None
    additional_data: str | None = Field(default=None, alias="additionalData")
    birthplace: str | None = None
    hometown: str | None = None
    places_lived: str | None = Field(default=None, alias="placesLived")
    is_collapsed: bool | None = Field(default=None, alias="isCollapsed")
    position_x: float | None = Field(default=None, alias="positionX")
    position_y: float | None = Field(default=None, alias="positionY")


class MemberPositionUpdate(BaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    position_x: float = Field(alias="positionX")
    position_y: float = Field(alias="positionY")


class MemberCollapsedUpdate(BaseModel):
    """One entry in a bulk collapsed-state update (expand-all / collapse-selected)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    is_collapsed: bool = Field(alias="isCollapsed")


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
