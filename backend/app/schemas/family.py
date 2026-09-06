"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged.

DB columns are snake_case; `MemberOut`/`MemberCreate` and related member schemas
expose camelCase automatically via the ``FamilyTreeBaseModel`` /
``FamilyTreeOrmBaseModel`` alias-generator base classes.  Relation, disease, and
other schemas intentionally stay snake_case because the frontend reads them
as-is.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import FamilyTreeBaseModel, FamilyTreeOrmBaseModel

# --- Members ---------------------------------------------------------------


# Free-text member fields that should be trimmed of leading/trailing
# whitespace on every write path, mirroring what gedcom.py already does for
# imported members. Excludes places_lived (JSON-encoded structured data),
# image_data/dates (not name-like text), and identifiers.
_TRIMMED_MEMBER_FIELDS = (
    "gender",
    "academic_title",
    "first_name",
    "middle_names",
    "baptismal_name",
    "last_name",
    "maiden_name",
    "birthplace",
    "hometown",
    "cemetery",
    "additional_data",
)


class _TrimMemberStringsMixin:
    """Strips whitespace from free-text member fields before validation.

    Fields are declared on the MemberCreate/MemberUpdate subclasses, not here
    (check_fields=False), and only present string values are touched — absent
    fields on a partial update stay absent, and None passes through unchanged.
    """

    @field_validator(*_TRIMMED_MEMBER_FIELDS, mode="before", check_fields=False)
    @classmethod
    def _trim_strings(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class MemberOut(FamilyTreeOrmBaseModel):
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
    adopted: bool = False
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    cemetery: str | None = None
    places_lived: str | None = None
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberSurfaceOut(FamilyTreeOrmBaseModel):
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
    # birthplace/hometown/cemetery are small, default-visible List-view columns,
    # and places_lived is a short JSON list the Map view renders as markers, so
    # they ride along in the surface payload (unlike the heavier
    # additional_data detail field, which stays deferred to the per-member
    # fetch).
    birthplace: str | None = None
    hometown: str | None = None
    cemetery: str | None = None
    places_lived: str | None = None
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberSearchHitOut(MemberSurfaceOut):
    """A searchable member surface annotated with its containing tree."""

    workspace_id: str
    workspace_name: str


class SearchSectionLabel(BaseModel):
    id: str
    name: str


class WorkspaceSearchHitOut(MemberSurfaceOut):
    """A member surface annotated with the caller's readable section labels.

    ``sections`` lists only the sections *this caller* may read — a scoped
    caller never sees a label for a section their grant doesn't reach, even
    when the member also belongs to one. ``unassigned`` is true only when a
    whole-workspace caller can see the member belongs to no section at all;
    it is always false for a scoped caller, who cannot tell "no sections"
    apart from "sections I can't see" (#1024).
    """

    sections: list[SearchSectionLabel] = []
    unassigned: bool = False


class WorkspaceSearchResultOut(BaseModel):
    items: list[WorkspaceSearchHitOut]
    total: int
    has_more: bool
    next_cursor: str | None = None


class PublicMemberOut(FamilyTreeOrmBaseModel):
    """Anonymous projection: enough to render a tree, without private detail."""

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
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberCreate(_TrimMemberStringsMixin, FamilyTreeBaseModel):
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
    adopted: bool = False
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    cemetery: str | None = None
    places_lived: str | None = None
    is_collapsed: bool = False
    position_x: float = 0
    position_y: float = 0


class MemberUpdate(_TrimMemberStringsMixin, FamilyTreeBaseModel):
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
    adopted: bool | None = None
    # Parent slots are represented by ``parent`` relation rows, not columns on
    # Member.  They live on this update payload so identity, parent, and vital
    # date edits can commit as one transaction.
    paternal_parent_id: str | None = None
    maternal_parent_id: str | None = None
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    cemetery: str | None = None
    places_lived: str | None = None
    is_collapsed: bool | None = None
    position_x: float | None = None
    position_y: float | None = None


class MemberPositionUpdate(FamilyTreeBaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    position_x: float
    position_y: float


class MemberCollapsedUpdate(FamilyTreeBaseModel):
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
    label: str | None = None
    color: str | None = None
    stroke_width: float | None = None
    stroke_dasharray: str | None = None


class RelationTypeCreate(BaseModel):
    # Ids double as i18n key segments, so keep them URL- and i18next-safe.
    id: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    description: str | None = Field(default=None, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=64)
    stroke_width: float | None = Field(default=None, ge=0.5, le=12)
    stroke_dasharray: str | None = Field(
        default=None,
        max_length=32,
        pattern=r"^[0-9]+(\s*,\s*[0-9]+)*$",
    )


class RelationTypeUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=64)
    stroke_width: float | None = Field(default=None, ge=0.5, le=12)
    stroke_dasharray: str | None = Field(
        default=None,
        max_length=32,
        pattern=r"^[0-9]+(\s*,\s*[0-9]+)*$",
    )


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


# --- Neighborhood view -----------------------------------------------------
class NeighborhoodContinuation(BaseModel):
    """What was left out of this page and where — "42 more in North America".

    ``remaining_count`` is the number of readable members of that scope not yet
    delivered. It is a count over the scope, not over what the traversal can
    still reach from the focus root: an exact reachable count would need the
    unbounded walk the budget exists to prevent.
    """

    #: ``None`` for the workspace-wide scope (no section filter in effect).
    section_id: str | None = None
    section_name: str | None = None
    remaining_count: int


class NeighborhoodOut(BaseModel):
    members: list[MemberSurfaceOut]
    relations: list[RelationOut]
    root_id: str
    truncated: bool
    total_member_count: int
    #: Cursor that resumes this traversal where the page stopped; ``None`` when
    #: nothing is left or the cursor chain has hit its ceiling.
    next_cursor: str | None = None
    continuations: list[NeighborhoodContinuation] = []
