"""Members, relations and diseases — all scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_readable_tree_public,
    get_writable_tree,
    require_domain,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import Member, MemberDisease, Relation, RelationType, Tree
from app.models.user import User
from app.schemas.family import (
    DiseaseCreate,
    DiseaseOut,
    DiseaseUpdate,
    MemberCollapsedUpdate,
    MemberCreate,
    MemberOut,
    MemberPositionUpdate,
    MemberSurfaceOut,
    MemberUpdate,
    RelationCreate,
    RelationOut,
)
from app.services.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.settings_service import get_media_limits
from app.services.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_image_field,
)
from app.services.storage_usage import QuotaExceeded, check_media_quota, check_tree_quota

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


def _get_member(db: Session, tree: Tree, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


# --- Members ---------------------------------------------------------------
@router.get("/members", response_model=list[MemberOut])
def list_members(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    db: Session = Depends(get_db),
    surface: bool = Query(False),
):
    if surface:
        stmt = (
            select(
                Member.id,
                Member.gender,
                Member.academic_title,
                Member.first_name,
                Member.middle_names,
                Member.baptismal_name,
                Member.last_name,
                Member.maiden_name,
                Member.image_data,
                Member.date_of_birth,
                Member.date_of_death,
                Member.date_of_birth_sort,
                Member.date_of_death_sort,
                Member.deceased,
                Member.is_collapsed,
                Member.position_x,
                Member.position_y,
            )
            .where(Member.tree_id == tree.id)
            .order_by(Member.id)
        )
        return [
            MemberSurfaceOut(**row._mapping)
            for row in db.execute(apply_pagination(stmt, pagination)).all()
        ]
    statement = select(Member).where(Member.tree_id == tree.id).order_by(Member.id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(
    payload: MemberCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    new_image_url: str | None = None
    try:
        new_image_url_candidate = process_image_field(
            tree.id,
            data.get("image_data"),
            get_media_limits(db),
        )
        data["image_data"] = new_image_url_candidate
        prefix = MEDIA_URL_PREFIX
        if new_image_url_candidate and new_image_url_candidate.startswith(prefix):
            new_image_url = new_image_url_candidate
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Check media quota (write-then-verify: the file is already on disk, so
    # compute_usage() counts it; pass 0 to avoid double-counting it).
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc

    # Check tree-data quota (pre-write estimate).
    try:
        check_tree_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded as exc:
        if new_image_url:
            delete_media(new_image_url)
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    member = Member(tree_id=tree.id, **data)
    db.add(member)
    label = (
        " ".join(filter(None, [data.get("first_name"), data.get("last_name")])) or None
    )
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="member", target_id=member.id, target_label=label)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    return member


@router.patch("/members/positions", status_code=204)
def update_member_positions(
    payload: list[MemberPositionUpdate],
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Persist many member positions in one round-trip (re-layout / drag).

    Declared before ``/members/{member_id}`` so the literal ``positions`` path
    isn't captured as a member id. Unknown ids are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(ids))
        )
    }
    for p in payload:
        member = members.get(p.id)
        if member is not None:
            member.position_x = p.position_x
            member.position_y = p.position_y
    db.commit()
    publish_tree_event(
        db, tree, "tree.layout_changed", {"tree_id": tree.id}
    )


@router.patch("/members/collapsed", status_code=204)
def update_member_collapsed(
    payload: list[MemberCollapsedUpdate],
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Persist collapse/expand state for many members in one round-trip.

    Declared before ``/members/{member_id}`` so the literal ``collapsed`` path
    isn't captured as a member id. Unknown ids are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(ids))
        )
    }
    for p in payload:
        member = members.get(p.id)
        if member is not None:
            member.is_collapsed = p.is_collapsed
    db.commit()


@router.get("/members/{member_id}", response_model=MemberOut)
def get_member(
    member_id: str,
    tree: Tree = Depends(get_readable_tree_public),
    db: Session = Depends(get_db),
):
    return _get_member(db, tree, member_id)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    changes = payload.model_dump(exclude_unset=True)
    new_image_url: str | None = None
    if "image_data" in changes:
        try:
            new_url = process_image_field(
                tree.id,
                changes["image_data"],
                get_media_limits(db),
            )
            changes["image_data"] = new_url
            if new_url and new_url.startswith(MEDIA_URL_PREFIX):
                new_image_url = new_url
        except ImageTooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (UnsupportedImageType, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Check media quota for the new image (write-then-verify: file already on
    # disk and counted by compute_usage, so pass 0 to avoid double-counting).
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc
    # Capture before-state for diff details (skip noisy positional/internal fields).
    _SKIP_DIFF = {"position_x", "position_y", "is_collapsed", "image_data"}
    before = {k: getattr(member, k) for k in changes if k not in _SKIP_DIFF}
    for key, value in changes.items():
        setattr(member, key, value)
    after = {k: getattr(member, k) for k in before}
    diff_details: dict | None = None
    changed = {
        k: {"before": before[k], "after": after[k]}
        for k in before
        if before[k] != after[k]
    }
    if changed:
        diff_details = {
            "before": {k: v["before"] for k, v in changed.items()},
            "after": {k: v["after"] for k, v in changed.items()},
        }
    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(db, tree_id=tree.id, actor=user, action="update",
                    target_type="member", target_id=member.id, target_label=label,
                    details=diff_details)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    return member


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(db, tree_id=tree.id, actor=user, action="delete",
                    target_type="member", target_id=member.id, target_label=label)
    db.delete(member)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )


# --- Relations -------------------------------------------------------------
@router.get("/relations", response_model=list[RelationOut])
def list_relations(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    db: Session = Depends(get_db),
):
    statement = (
        select(Relation)
        .where(Relation.tree_id == tree.id)
        .order_by(
            Relation.from_member_id,
            Relation.to_member_id,
            Relation.relation_type,
        )
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/relations", response_model=RelationOut, status_code=201)
def add_relation(
    payload: RelationCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from_member = db.scalar(
        select(Member).where(
            Member.id == payload.from_member_id, Member.tree_id == tree.id
        )
    )
    if from_member is None:
        raise HTTPException(
            status_code=404, detail="from_member_id not found in this tree"
        )
    to_member = db.scalar(
        select(Member).where(
            Member.id == payload.to_member_id, Member.tree_id == tree.id
        )
    )
    if to_member is None:
        raise HTTPException(
            status_code=404, detail="to_member_id not found in this tree"
        )
    if db.get(RelationType, payload.relation_type) is None:
        raise HTTPException(status_code=404, detail="Unknown relation_type")

    key = (tree.id, payload.from_member_id, payload.to_member_id, payload.relation_type)
    relation = db.get(Relation, key)
    if relation is None:
        try:
            check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
        except QuotaExceeded as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        relation = Relation(tree_id=tree.id, **payload.model_dump())
        db.add(relation)
        label = (
            f"{payload.from_member_id} → "
            f"{payload.to_member_id} ({payload.relation_type})"
        )
        record_activity(db, tree_id=tree.id, actor=user, action="create",
                        target_type="relation", target_label=label)
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db, tree, "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )
    return relation


@router.delete("/relations", status_code=204)
def remove_relation(
    from_member_id: str,
    to_member_id: str,
    relation_type: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    relation = db.get(
        Relation, (tree.id, from_member_id, to_member_id, relation_type)
    )
    if relation is not None:
        label = f"{from_member_id} → {to_member_id} ({relation_type})"
        record_activity(db, tree_id=tree.id, actor=user, action="delete",
                        target_type="relation", target_label=label)
        db.delete(relation)
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db, tree, "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )


# --- Diseases --------------------------------------------------------------
@router.get(
    "/diseases",
    response_model=list[DiseaseOut],
    dependencies=[Depends(require_domain("diseases"))],
)
def list_diseases(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(MemberDisease)
        .where(MemberDisease.tree_id == tree.id)
        .order_by(MemberDisease.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post(
    "/diseases",
    response_model=DiseaseOut,
    status_code=201,
    dependencies=[Depends(require_domain("diseases"))],
)
def add_disease(
    payload: DiseaseCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_member(db, tree, payload.member_id)
    try:
        check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
    except QuotaExceeded as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    disease = MemberDisease(tree_id=tree.id, **payload.model_dump())
    db.add(disease)
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="disease", target_label=payload.name)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    return disease


@router.patch(
    "/diseases/{disease_id}",
    response_model=DiseaseOut,
    dependencies=[Depends(require_domain("diseases"))],
)
def update_disease(
    disease_id: str,
    payload: DiseaseUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    for key, value in payload.model_dump().items():
        setattr(disease, key, value)
    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="disease", target_id=disease_id, target_label=disease.name,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    return disease


@router.delete(
    "/diseases/{disease_id}",
    status_code=204,
    dependencies=[Depends(require_domain("diseases"))],
)
def delete_disease(
    disease_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    record_activity(
        db, tree_id=tree.id, actor=user, action="delete",
        target_type="disease", target_id=disease_id, target_label=disease.name,
    )
    db.delete(disease)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
