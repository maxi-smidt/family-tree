"""Members, relations and diseases — all scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException
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
    MemberUpdate,
    RelationCreate,
    RelationOut,
)
from app.services.activity import record_activity
from app.services.settings_service import get_media_limits
from app.services.storage import ImageTooLarge, UnsupportedImageType, process_image_field

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
):
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
    try:
        data["imageData"] = process_image_field(
            tree.id,
            data.get("imageData"),
            get_media_limits(db),
        )
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    member = Member(tree_id=tree.id, **data)
    db.add(member)
    label = " ".join(filter(None, [data.get("firstName"), data.get("lastName")])) or None
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="member", target_id=member.id, target_label=label)
    db.commit()
    db.refresh(member)
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
            member.positionX = p.positionX
            member.positionY = p.positionY
    db.commit()


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
            member.isCollapsed = p.isCollapsed
    db.commit()


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
    if "imageData" in changes:
        try:
            changes["imageData"] = process_image_field(
                tree.id,
                changes["imageData"],
                get_media_limits(db),
            )
        except ImageTooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (UnsupportedImageType, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Capture before-state for diff details (skip noisy positional/internal fields).
    _SKIP_DIFF = {"positionX", "positionY", "isCollapsed", "imageData"}
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
    label = " ".join(filter(None, [member.firstName, member.lastName])) or None
    record_activity(db, tree_id=tree.id, actor=user, action="update",
                    target_type="member", target_id=member.id, target_label=label,
                    details=diff_details)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    label = " ".join(filter(None, [member.firstName, member.lastName])) or None
    record_activity(db, tree_id=tree.id, actor=user, action="delete",
                    target_type="member", target_id=member.id, target_label=label)
    db.delete(member)
    db.commit()


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
        relation = Relation(tree_id=tree.id, **payload.model_dump())
        db.add(relation)
        label = (
            f"{payload.from_member_id} → "
            f"{payload.to_member_id} ({payload.relation_type})"
        )
        record_activity(db, tree_id=tree.id, actor=user, action="create",
                        target_type="relation", target_label=label)
        db.commit()
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
    disease = MemberDisease(tree_id=tree.id, **payload.model_dump())
    db.add(disease)
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="disease", target_label=payload.name)
    db.commit()
    db.refresh(disease)
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
    db.refresh(disease)
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
