"""Virtual multi-tree views — composite content read endpoints.

Every feature a normal tree exposes works on a virtual tree by reading rows
whose ``tree_id`` is in the flattened source set and remapping member ids to
the composite node ids; see ``app.services.virtual_views.virtual_view_composite`` for the
aggregation itself. Configuration CRUD (name, sources, match recomputation)
lives in ``virtual_views.py``.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.activity_query import activity_page, hidden_activity_target_types
from app.api.deps import get_current_user, require_feature
from app.db.session import get_db
from app.models import (
    Document,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    User,
)
from app.models.virtual_view import VirtualViewMemberMatch, VirtualViewPosition
from app.schemas.activity import ActivityPageOut
from app.schemas.content import (
    DocumentOut,
    EventLinkOut,
    EventOut,
    GalleryImageOut,
    GalleryLinkOut,
    GeocodeOut,
    GeocodeRequest,
    StoryLinkOut,
    StoryOut,
)
from app.schemas.family import DiseaseOut, RelationOut
from app.schemas.quality import QualityReport
from app.schemas.statistics import StatisticsReport
from app.schemas.virtual_view import (
    VirtualMemberOut,
    VirtualPositionItem,
    VirtualViewMetadataOut,
    VirtualViewSourceTreeRef,
)
from app.services.event_bus import event_bus
from app.services.geocoding import resolve_batch, resolve_single
from app.services.quality_checks import run_quality_checks
from app.services.statistics import compute_statistics
from app.services.virtual_views.virtual_view_access import resolve_view, view_last_opened
from app.services.virtual_views.virtual_view_composite import (
    aggregate,
    analytics_members,
    analytics_relations,
    build_composite_diseases,
    build_composite_members,
    build_composite_relations,
    build_id_map,
    ensure_matches,
    primary_member_map,
    remap_member_links,
)
from app.services.virtual_views.virtual_view_sources import flatten_tree_ids

router = APIRouter(
    prefix="/virtual-views",
    tags=["virtual-views"],
    dependencies=[Depends(require_feature("virtual_views"))],
)


@router.get("/{view_id}/metadata", response_model=VirtualViewMetadataOut)
def get_virtual_view_metadata(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewMetadataOut:
    view = resolve_view(db, view_id, user)
    ensure_matches(db, view)
    # The underlying real trees (nested views flattened) are the actual data
    # sources of the composite.
    source_ids = flatten_tree_ids(db, view)
    source_trees = [
        VirtualViewSourceTreeRef(
            id=tid, name=(db.get(Tree, tid) or Tree(name="")).name
        )
        for tid in source_ids
    ]
    # Count distinct nodes in the composite.
    id_map = build_id_map(db, view)
    node_ids = set(id_map.get(mid, mid) for mid in (
        r[0] for r in db.execute(
            select(Member.id).where(Member.tree_id.in_(source_ids))
        ).all()
    ))
    overlap_count = db.execute(
        select(VirtualViewMemberMatch.group_id)
        .where(VirtualViewMemberMatch.view_id == view_id)
        .distinct()
    ).fetchall().__len__()
    pos_count = db.execute(
        select(VirtualViewPosition.node_id)
        .where(VirtualViewPosition.view_id == view_id)
    ).fetchall().__len__()
    has_layout = pos_count > 0 and pos_count >= len(node_ids)
    db.commit()
    return VirtualViewMetadataOut(
        id=view.id,
        name=view.name,
        created_at=view.created_at,
        last_opened=view_last_opened(db, view.id, user.id),
        source_trees=source_trees,
        overlap_count=overlap_count,
        has_layout=has_layout,
    )


@router.get("/{view_id}/members", response_model=list[VirtualMemberOut])
def list_virtual_members(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VirtualMemberOut]:
    view = resolve_view(db, view_id, user)
    return build_composite_members(db, view)


@router.get("/{view_id}/relations", response_model=list[RelationOut])
def list_virtual_relations(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RelationOut]:
    view = resolve_view(db, view_id, user)
    return build_composite_relations(db, view)


@router.get("/{view_id}/diseases", response_model=list[DiseaseOut])
def list_virtual_diseases(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DiseaseOut]:
    view = resolve_view(db, view_id, user)
    return build_composite_diseases(db, view)


@router.get("/{view_id}/gallery/images", response_model=list[GalleryImageOut])
def list_virtual_gallery_images(
    view_id: str,
    _: None = Depends(require_feature("gallery")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GalleryImageOut]:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    return [
        GalleryImageOut.model_validate(i)
        for i in aggregate(db, source_ids, GalleryImage)
    ]


@router.get("/{view_id}/gallery/links", response_model=list[GalleryLinkOut])
def list_virtual_gallery_links(
    view_id: str,
    _: None = Depends(require_feature("gallery")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GalleryLinkOut]:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = build_id_map(db, view)
    rows = db.scalars(
        select(GalleryMemberLink)
        .join(Member, Member.id == GalleryMemberLink.member_id)
        .where(Member.tree_id.in_(source_ids))
    ).all()
    seen: set[tuple[str, str]] = set()
    links: list[GalleryLinkOut] = []
    for link in rows:
        member_id = id_map.get(link.member_id, link.member_id)
        key = (link.gallery_image_id, member_id)
        if key in seen:
            continue
        seen.add(key)
        links.append(
            GalleryLinkOut(
                gallery_image_id=link.gallery_image_id,
                member_id=member_id,
                x=link.x,
                y=link.y,
                w=link.w,
                h=link.h,
            )
        )
    return links


@router.get("/{view_id}/events", response_model=list[EventOut])
def list_virtual_events(
    view_id: str,
    _: None = Depends(require_feature("events")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    events = aggregate(db, source_ids, Event)
    event_ids = [e.id for e in events]
    doc_map: dict[str, list[str]] = {}
    if event_ids:
        rows = db.execute(
            select(EventDocumentLink.event_id, EventDocumentLink.document_id).where(
                EventDocumentLink.event_id.in_(event_ids)
            )
        ).all()
        for eid, did in rows:
            doc_map.setdefault(eid, []).append(did)
    return [
        EventOut.model_validate(e).model_copy(
            update={"document_ids": doc_map.get(e.id, [])}
        )
        for e in events
    ]


@router.get("/{view_id}/events/links", response_model=list[EventLinkOut])
def list_virtual_event_links(
    view_id: str,
    _: None = Depends(require_feature("events")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventLinkOut]:
    view = resolve_view(db, view_id, user)
    pairs = remap_member_links(db, view, EventMemberLink, "member_id", "event_id")
    return [EventLinkOut(event_id=other, member_id=node) for other, node in pairs]


@router.get("/{view_id}/stories", response_model=list[StoryOut])
def list_virtual_stories(
    view_id: str,
    _: None = Depends(require_feature("stories")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StoryOut]:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    stories = db.scalars(
        select(Story).where(Story.tree_id.in_(source_ids))
    ).all()
    story_ids = [s.id for s in stories]
    doc_map: dict[str, list[str]] = {}
    if story_ids:
        rows = db.execute(
            select(StoryDocumentLink.story_id, StoryDocumentLink.document_id).where(
                StoryDocumentLink.story_id.in_(story_ids)
            )
        ).all()
        for sid, did in rows:
            doc_map.setdefault(sid, []).append(did)
    return [
        StoryOut.model_validate(s).model_copy(
            update={"document_ids": doc_map.get(s.id, [])}
        )
        for s in stories
    ]


@router.get("/{view_id}/stories/links", response_model=list[StoryLinkOut])
def list_virtual_story_links(
    view_id: str,
    _: None = Depends(require_feature("stories")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StoryLinkOut]:
    view = resolve_view(db, view_id, user)
    pairs = remap_member_links(db, view, StoryMemberLink, "member_id", "story_id")
    return [StoryLinkOut(story_id=other, member_id=node) for other, node in pairs]


@router.get("/{view_id}/documents", response_model=list[DocumentOut])
def list_virtual_documents(
    view_id: str,
    # The flag/domain key is kept as "sources" for backward compatibility; the
    # feature is now presented as "Documents".
    _: None = Depends(require_feature("sources")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentOut]:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = build_id_map(db, view)
    documents = db.scalars(
        select(Document)
        .where(Document.tree_id.in_(source_ids))
        .options(selectinload(Document.files))
    ).all()
    doc_ids = [d.id for d in documents]
    member_map: dict[str, list[str]] = {}
    if doc_ids:
        rows = db.execute(
            select(DocumentMemberLink.document_id, DocumentMemberLink.member_id).where(
                DocumentMemberLink.document_id.in_(doc_ids)
            )
        ).all()
        for did, mid in rows:
            member_map.setdefault(did, []).append(id_map.get(mid, mid))
    return [
        DocumentOut.model_validate(d).model_copy(
            update={"member_ids": member_map.get(d.id, [])}
        )
        for d in documents
    ]


@router.get("/{view_id}/activity", response_model=ActivityPageOut)
def list_virtual_activity(
    view_id: str,
    _: None = Depends(require_feature("activity_log")),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActivityPageOut:
    view = resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    return activity_page(
        db,
        source_ids,
        limit=limit,
        offset=offset,
        actor=actor,
        action=action,
        target_type=target_type,
        hidden_target_types=hidden_activity_target_types(db, user, source_ids),
    )


@router.post("/{view_id}/geocode", response_model=list[GeocodeOut])
def virtual_geocode_batch(
    view_id: str,
    payload: GeocodeRequest,
    _: None = Depends(require_feature("map")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GeocodeOut]:
    resolve_view(db, view_id, user)  # auth only — geocode cache is global
    return resolve_batch(db, payload.locations)


@router.get("/{view_id}/geocode/preview", response_model=GeocodeOut)
def virtual_geocode_preview(
    view_id: str,
    q: str = Query(..., min_length=1),
    _: None = Depends(require_feature("map")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GeocodeOut:
    resolve_view(db, view_id, user)
    return resolve_single(db, q)


@router.get("/{view_id}/statistics", response_model=StatisticsReport)
def get_virtual_statistics(
    view_id: str,
    _: None = Depends(require_feature("statistics")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatisticsReport:
    view = resolve_view(db, view_id, user)
    members = analytics_members(db, view)
    return compute_statistics(members, view.id)


@router.get("/{view_id}/quality-report", response_model=QualityReport)
def get_virtual_quality_report(
    view_id: str,
    _: None = Depends(require_feature("quality_report")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QualityReport:
    view = resolve_view(db, view_id, user)
    members = analytics_members(db, view)
    primary_map = primary_member_map(db, view)
    relations = analytics_relations(db, view, primary_map)
    issues = run_quality_checks(members, relations)
    return QualityReport(
        tree_id=view.id,
        total_members=len(members),
        issues=issues,
    )


@router.patch("/{view_id}/members/positions", status_code=204)
def save_virtual_positions(
    view_id: str,
    positions: list[VirtualPositionItem],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Persist alignment positions for this view."""
    view = resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can save layout")
    for item in positions:
        existing = db.get(VirtualViewPosition, (view_id, item.id))
        if existing:
            existing.position_x = item.position_x
            existing.position_y = item.position_y
        else:
            db.add(
                VirtualViewPosition(
                    view_id=view_id,
                    node_id=item.id,
                    position_x=item.position_x,
                    position_y=item.position_y,
                )
            )
    db.commit()
    event_bus.publish([view.owner_id], "tree.layout_changed", {"tree_id": view_id})
