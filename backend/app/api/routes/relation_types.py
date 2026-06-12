"""Instance-wide relation type registry.

Every authenticated user can read the registry; creating, editing and deleting
types is admin-only. Relations store the type id as a plain string, so the
registry only controls what the UI offers — deleting a type that is still in
use is rejected to keep existing relations selectable.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models import Relation, RelationType
from app.schemas.family import RelationTypeCreate, RelationTypeOut, RelationTypeUpdate

# The tree structure itself is built from "parent" relations, so that type can
# never be removed.
PARENT_RELATION_TYPE = "parent"

router = APIRouter(
    prefix="/relation-types",
    tags=["relation-types"],
    dependencies=[Depends(get_current_user)],
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
    rt = RelationType(id=payload.id, description=payload.description)
    db.add(rt)
    db.commit()
    return rt


@admin_router.patch("/{rt_id}", response_model=RelationTypeOut)
def update_relation_type(
    rt_id: str, payload: RelationTypeUpdate, db: Session = Depends(get_db)
):
    rt = db.get(RelationType, rt_id)
    if rt is None:
        raise HTTPException(status_code=404, detail="Relation type not found")
    rt.description = payload.description
    db.commit()
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
        select(func.count())
        .select_from(Relation)
        .where(Relation.relation_type == rt_id)
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail="Relation type is still used by existing relations",
        )
    db.delete(rt)
    db.commit()
