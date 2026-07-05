"""Schemas mirroring the frontend `MemberDB`, `RelationDB`, `DiseaseDB`
contracts so the React data layer keeps working unchanged.

DB columns are snake_case; `MemberOut`/`MemberCreate` and related member schemas
expose camelCase automatically via the ``FamilyTreeBaseModel`` /
``FamilyTreeOrmBaseModel`` alias-generator base classes.  Relation, disease, and
other schemas intentionally stay snake_case because the frontend reads them
as-is.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import FamilyTreeBaseModel, FamilyTreeOrmBaseModel
from app.schemas.tree import TreeOut


# --- Members ---------------------------------------------------------------
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
    linked_tree_id: str | None = None
    linked_member_id: str | None = None
    # Transient outcome of the bridge-person mirror on updates (not a column):
    # "synced" when the counterpart row was updated too, "skipped_no_access"
    # when identity fields changed but the actor may not write the other tree.
    bridge_sync: str | None = None


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
    linked_tree_id: str | None = None
    linked_member_id: str | None = None


class MemberCreate(FamilyTreeBaseModel):
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
    linked_tree_id: str | None = None
    linked_member_id: str | None = None


class MemberUpdate(FamilyTreeBaseModel):
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
    additional_data: str | None = None
    birthplace: str | None = None
    hometown: str | None = None
    cemetery: str | None = None
    places_lived: str | None = None
    is_collapsed: bool | None = None
    position_x: float | None = None
    position_y: float | None = None
    linked_tree_id: str | None = None
    linked_member_id: str | None = None


class MemberPositionUpdate(FamilyTreeBaseModel):
    """One entry in a bulk position update (used after a re-layout / drag)."""

    id: str
    position_x: float
    position_y: float


class MemberCollapsedUpdate(FamilyTreeBaseModel):
    """One entry in a bulk collapsed-state update (expand-all / collapse-selected)."""

    id: str
    is_collapsed: bool


class MemberSubtreeCreate(FamilyTreeBaseModel):
    """Request body for the create-and-link-subtree endpoint."""

    name: str


class MemberLinkRequest(FamilyTreeBaseModel):
    """Request body for establishing a tree-in-tree bridge on an existing
    member: either by finding a matching person already in the target tree
    (``mode="existing"``) or by copying the member into it as a new bridge
    person (``mode="create"``)."""

    linked_tree_id: str
    mode: Literal["existing", "create"]
    counterpart_member_id: str | None = None
    # Per-field resolution choices (a = this member, b = counterpart) applied
    # when mode="existing" reconciles the bridge pair's conflicting fields.
    # Ignored for mode="create" (nothing to reconcile — the counterpart is a
    # fresh clone of this member).
    field_choices: dict[str, Literal["a", "b", "combine"]] = {}


class BridgeSyncRequest(FamilyTreeBaseModel):
    """Resolve bridge-person drift by copying fields across the link.

    ``push`` copies this member's values onto the counterpart; ``pull`` adopts
    the counterpart's values into this member.
    """

    direction: Literal["push", "pull"]


class MemberSubtreeOut(FamilyTreeBaseModel):
    """Result of creating a linked subtree: the new tree plus the updated
    anchor member (whose linked_tree_id/linked_member_id now point at the
    seeded counterpart)."""

    tree: TreeOut
    anchor: MemberOut


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
class NeighborhoodOut(BaseModel):
    members: list[MemberSurfaceOut]
    relations: list[RelationOut]
    root_id: str
    truncated: bool
    total_member_count: int
