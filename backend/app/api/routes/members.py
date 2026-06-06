"""Members, relations and diseases — all scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import Member, MemberDisease, Relation, Tree
from app.schemas.family import (
    DiseaseCreate,
    DiseaseOut,
    DiseaseUpdate,
    MemberCreate,
    MemberOut,
    MemberPositionUpdate,
    MemberUpdate,
    RelationCreate,
    RelationOut,
)
from app.services.storage import process_image_field

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


def _get_member(db: Session, tree: Tree, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


# --- Members ---------------------------------------------------------------
@router.get("/members", response_model=list[MemberOut])
def list_members(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(select(Member).where(Member.tree_id == tree.id)).all()


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(
    payload: MemberCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    data["imageData"] = process_image_field(tree.id, data.get("imageData"))
    member = Member(tree_id=tree.id, **data)
    db.add(member)
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


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    changes = payload.model_dump(exclude_unset=True)
    if "imageData" in changes:
        changes["imageData"] = process_image_field(tree.id, changes["imageData"])
    for key, value in changes.items():
        setattr(member, key, value)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    db.delete(member)
    db.commit()


# --- Relations -------------------------------------------------------------
@router.get("/relations", response_model=list[RelationOut])
def list_relations(
    tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)
):
    return db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()


@router.post("/relations", response_model=RelationOut, status_code=201)
def add_relation(
    payload: RelationCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    key = (tree.id, payload.from_member_id, payload.to_member_id, payload.relation_type)
    relation = db.get(Relation, key)
    if relation is None:
        relation = Relation(tree_id=tree.id, **payload.model_dump())
        db.add(relation)
        db.commit()
    return relation


@router.delete("/relations", status_code=204)
def remove_relation(
    from_member_id: str,
    to_member_id: str,
    relation_type: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    relation = db.get(
        Relation, (tree.id, from_member_id, to_member_id, relation_type)
    )
    if relation is not None:
        db.delete(relation)
        db.commit()


# --- Diseases --------------------------------------------------------------
@router.get("/diseases", response_model=list[DiseaseOut])
def list_diseases(
    tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)
):
    return db.scalars(
        select(MemberDisease).where(MemberDisease.tree_id == tree.id)
    ).all()


@router.post("/diseases", response_model=DiseaseOut, status_code=201)
def add_disease(
    payload: DiseaseCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_member(db, tree, payload.member_id)
    disease = MemberDisease(tree_id=tree.id, **payload.model_dump())
    db.add(disease)
    db.commit()
    db.refresh(disease)
    return disease


@router.patch("/diseases/{disease_id}", response_model=DiseaseOut)
def update_disease(
    disease_id: str,
    payload: DiseaseUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    for key, value in payload.model_dump().items():
        setattr(disease, key, value)
    db.commit()
    db.refresh(disease)
    return disease


@router.delete("/diseases/{disease_id}", status_code=204)
def delete_disease(
    disease_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    db.delete(disease)
    db.commit()
