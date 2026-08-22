"""Typed shapes for GEDCOM rows and the encrypted `.treedb` bundle.

These ``TypedDict``s type the plain-dict data that flows through
``app.services.gedcom``, ``app.api.routes.export_import``, and
``app.services.crypto_export``. A ``TypedDict`` is a plain ``dict`` at runtime,
so existing ``.get()`` / ``dict(bundle)`` / mutation code keeps working.
"""

from typing import NotRequired, TypedDict

# ---------------------------------------------------------------------------
# GEDCOM row shapes
# ---------------------------------------------------------------------------


class GedcomMember(TypedDict, total=False):
    """Member row consumed/produced by the GEDCOM serializer/parser.

    ``id`` is always present; every other key may be absent (serializer) or
    ``None`` (parser).
    """

    id: str
    academic_title: str | None
    first_name: str | None
    middle_names: str | None
    baptismal_name: str | None
    last_name: str | None
    maiden_name: str | None
    gender: str | None
    date_of_birth: str | None
    date_of_death: str | None
    date_of_birth_sort: str | None
    date_of_death_sort: str | None
    deceased: bool
    birthplace: str | None
    hometown: str | None
    cemetery: str | None
    additional_data: str | None
    places_lived: str | None
    image_data: str | None
    is_collapsed: bool
    position_x: float
    position_y: float
    adopted: bool


class GedcomRelation(TypedDict):
    """Relation row consumed/produced by the GEDCOM serializer/parser."""

    from_member_id: str
    to_member_id: str
    relation_type: str


class GedcomDocument(TypedDict, total=False):
    """Document row consumed by the GEDCOM serializer."""

    id: str
    title: str | None
    document_date: str | None
    description: str | None


class GedcomDocumentFile(TypedDict, total=False):
    """Document-file row consumed by the GEDCOM serializer."""

    document_id: str
    kind: str
    url: str | None
    mime_type: str | None
    filename: str | None


class GedcomCitation(TypedDict):
    """Citation row consumed by the GEDCOM serializer."""

    document_id: str
    member_id: str


BundleCitationRow = GedcomCitation
"""Citation/document-member link row used inside bundles."""


class GedcomRecord(TypedDict):
    """Recursive node produced by ``_build_record_tree``."""

    xref: str | None
    tag: str
    value: str
    children: list["GedcomRecord"]


class GedcomParseResult(TypedDict):
    """Return shape of ``gedcom.parse_gedcom``."""

    members: list[GedcomMember]
    relations: list[GedcomRelation]
    _head_file: NotRequired[str | None]


# ---------------------------------------------------------------------------
# Bundle row shapes (raw ORM-column dicts used by export/import)
# ---------------------------------------------------------------------------


class BundleMemberRow(TypedDict, total=False):
    id: str
    tree_id: str
    gender: str | None
    academic_title: str | None
    first_name: str | None
    middle_names: str | None
    baptismal_name: str | None
    last_name: str | None
    maiden_name: str | None
    image_data: str | None
    date_of_birth: str | None
    date_of_death: str | None
    date_of_birth_sort: str | None
    date_of_death_sort: str | None
    additional_data: str | None
    birthplace: str | None
    hometown: str | None
    cemetery: str | None
    places_lived: str | None
    deceased: bool
    adopted: bool
    is_collapsed: bool
    linked_tree_id: str | None
    linked_member_id: str | None
    position_x: float
    position_y: float


class BundleRelationRow(TypedDict, total=False):
    tree_id: str
    from_member_id: str
    to_member_id: str
    relation_type: str


class BundleRelationTypeRow(TypedDict, total=False):
    id: str
    description: str | None
    label: str | None
    color: str | None
    stroke_width: int | None
    stroke_dasharray: str | None


class BundleDiseaseRow(TypedDict, total=False):
    id: str
    tree_id: str
    member_id: str
    name: str | None
    carrier_status: str | None
    inheritance_pattern: str | None
    diagnosis_date: str | None
    notes: str | None


class BundleTaskRow(TypedDict, total=False):
    id: str
    tree_id: str
    title: str | None
    notes: str | None
    done: bool
    created_at: str | None
    done_at: str | None


class BundleTaskLinkRow(TypedDict, total=False):
    task_id: str
    member_id: str


class BundleGalleryImageRow(TypedDict, total=False):
    id: str
    tree_id: str
    image_data: str | None
    title: str | None
    description: str | None
    created_at: str | None
    uploaded_at: str | None


class BundleGalleryLinkRow(TypedDict, total=False):
    gallery_image_id: str
    member_id: str
    x: float | None
    y: float | None
    w: float | None
    h: float | None


class BundleUnknownFaceRow(TypedDict, total=False):
    id: str
    gallery_image_id: str
    x: float | None
    y: float | None
    w: float | None
    h: float | None
    task_id: str | None
    created_at: str | None


class BundleEventRow(TypedDict, total=False):
    id: str
    tree_id: str
    event_type: str | None
    date: str | None
    location: str | None
    description: str | None
    created_at: str | None


class BundleEventLinkRow(TypedDict, total=False):
    event_id: str
    member_id: str


class BundleStoryRow(TypedDict, total=False):
    id: str
    tree_id: str
    title: str | None
    content: str | None
    date: str | None
    created_at: str | None
    updated_at: str | None


class BundleStoryLinkRow(TypedDict, total=False):
    story_id: str
    member_id: str


class BundleDocumentRow(TypedDict, total=False):
    id: str
    tree_id: str
    title: str | None
    document_date: str | None
    description: str | None
    created_at: str | None
    updated_at: str | None


class BundleDocumentFileRow(TypedDict, total=False):
    id: str
    tree_id: str
    document_id: str
    kind: str | None
    filename: str | None
    url: str | None
    mime_type: str | None
    size: int | None
    created_at: str | None


class BundleDocumentMemberLinkRow(TypedDict, total=False):
    document_id: str
    member_id: str


class BundleEventDocumentLinkRow(TypedDict, total=False):
    event_id: str
    document_id: str


class BundleStoryDocumentLinkRow(TypedDict, total=False):
    story_id: str
    document_id: str


# ---------------------------------------------------------------------------
# Versioned bundle shapes
# ---------------------------------------------------------------------------


class TreeBundleV2(TypedDict, total=False):
    """Legacy v1.6 bundle; only the keys needed for migration are typed."""

    version: int
    sources: list[dict[str, object]]
    source_evidence: list[dict[str, object]]
    citations: list[dict[str, object]]
    story_attachments: list[dict[str, object]]


class TreeBundleV3(TypedDict, total=False):
    version: int
    app_version: str
    exported_at: str
    tree: dict[str, str]
    members: list[BundleMemberRow]
    relations: list[BundleRelationRow]
    relation_types: list[BundleRelationTypeRow]
    diseases: list[BundleDiseaseRow]
    gallery_images: list[BundleGalleryImageRow]
    gallery_links: list[BundleGalleryLinkRow]
    events: list[BundleEventRow]
    event_links: list[BundleEventLinkRow]
    stories: list[BundleStoryRow]
    story_links: list[BundleStoryLinkRow]
    documents: list[BundleDocumentRow]
    document_files: list[BundleDocumentFileRow]
    document_member_links: list[BundleDocumentMemberLinkRow]
    event_document_links: list[BundleEventDocumentLinkRow]
    story_document_links: list[BundleStoryDocumentLinkRow]


class TreeBundleV4(TypedDict, total=False):
    """Current bundle shape produced by ``export_tree``."""

    version: int
    app_version: str
    exported_at: str
    tree: dict[str, str]
    members: list[BundleMemberRow]
    relations: list[BundleRelationRow]
    relation_types: list[BundleRelationTypeRow]
    diseases: list[BundleDiseaseRow]
    tasks: list[BundleTaskRow]
    task_links: list[BundleTaskLinkRow]
    gallery_images: list[BundleGalleryImageRow]
    gallery_links: list[BundleGalleryLinkRow]
    unknown_faces: list[BundleUnknownFaceRow]
    events: list[BundleEventRow]
    event_links: list[BundleEventLinkRow]
    stories: list[BundleStoryRow]
    story_links: list[BundleStoryLinkRow]
    documents: list[BundleDocumentRow]
    document_files: list[BundleDocumentFileRow]
    document_member_links: list[BundleDocumentMemberLinkRow]
    event_document_links: list[BundleEventDocumentLinkRow]
    story_document_links: list[BundleStoryDocumentLinkRow]


TreeBundle = TreeBundleV2 | TreeBundleV3 | TreeBundleV4
"""Any bundle version that ``migrate_bundle`` knows how to read."""
