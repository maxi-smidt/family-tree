"""Instance-wide relation type registry.

The read-only registry is public because public tree views need its labels and
edge styles to render custom relations. Creating, editing and deleting types is
admin-only. Relations store the type id as a plain string, so the registry only
controls what the UI offers — deleting a type that is still in use is rejected
to keep existing relations selectable.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import Relation, RelationType
from app.schemas.family import RelationTypeCreate, RelationTypeOut, RelationTypeUpdate
from app.services.unit_of_work import UnitOfWork

# The tree structure itself is built from "parent" relations, so that type can
# never be removed.
PARENT_RELATION_TYPE = "parent"

router = APIRouter(
    prefix="/relation-types",
    tags=["relation-types"],
)

admin_router = APIRouter(
    prefix="/admin/relation-types",
    tags=["relation-types"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[RelationTypeOut])
def list_relation_types(db: Session = Depends(get_db)):
    return db.scalars(select(RelationType).order_by(RelationType.id)).all()


@admin_router.post("", response_model=RelationTypeOut, status_code=201)
def create_relation_type(payload: RelationTypeCreate, db: Session = Depends(get_db)):
    if db.get(RelationType, payload.id) is not None:
        raise HTTPException(status_code=409, detail="Relation type already exists")
    rt = RelationType(
        id=payload.id,
        description=payload.description,
        label=payload.label,
        color=payload.color,
        stroke_width=payload.stroke_width,
        stroke_dasharray=payload.stroke_dasharray,
    )
    with UnitOfWork(db):
        db.add(rt)
    return rt


@admin_router.patch("/{rt_id}", response_model=RelationTypeOut)
def update_relation_type(
    rt_id: str, payload: RelationTypeUpdate, db: Session = Depends(get_db)
):
    rt = db.get(RelationType, rt_id)
    if rt is None:
        raise HTTPException(status_code=404, detail="Relation type not found")
    data = payload.model_dump(exclude_unset=True)
    fields = ("description", "label", "color", "stroke_width", "stroke_dasharray")
    with UnitOfWork(db):
        for field in fields:
            if field in data:
                setattr(rt, field, data[field])
    return rt


@admin_router.delete("/{rt_id}", status_code=204)
def delete_relation_type(rt_id: str, db: Session = Depends(get_db)):
    rt = db.get(RelationType, rt_id)
    if rt is None:
        raise HTTPException(status_code=404, detail="Relation type not found")
    if rt_id == PARENT_RELATION_TYPE:
        raise HTTPException(
            status_code=409, detail="The parent relation type cannot be deleted"
        )
    in_use = db.scalar(
        select(func.count()).select_from(Relation).where(Relation.relation_type == rt_id)
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail="Relation type is still used by existing relations",
        )
    with UnitOfWork(db):
        db.delete(rt)
