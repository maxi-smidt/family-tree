"""Admin-managed feature flags (global state + beta allowlists)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.schemas.setting import FeatureFlagOut, FeatureFlagUpdate
from app.services import feature_service
from app.services.admin_audit import record_admin_audit

router = APIRouter(
    prefix="/admin/features",
    tags=["features"],
    dependencies=[Depends(require_admin)],
)


def _flag_out(db: Session, name: str) -> FeatureFlagOut:
    return FeatureFlagOut(
        name=name,
        state=feature_service.get_state(db, name),
        allowlist=feature_service.get_allowlist(db, name),
    )


@router.get("", response_model=list[FeatureFlagOut])
def list_features(db: Session = Depends(get_db)):
    return feature_service.get_flags_out(db)


@router.patch("/{name}", response_model=FeatureFlagOut)
def update_feature(
    name: str,
    payload: FeatureFlagUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if name not in feature_service.FEATURES:
        raise HTTPException(status_code=404, detail="Unknown feature")

    before = _flag_out(db, name)
    if payload.allowlist is not None:
        wanted = list(dict.fromkeys(payload.allowlist))
        existing = set(
            db.scalars(select(User.id).where(User.id.in_(wanted))).all()
        )
        unknown = [user_id for user_id in wanted if user_id not in existing]
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"Unknown user ids: {', '.join(unknown)}"
            )
        feature_service.set_allowlist(db, name, wanted)

    if payload.state is not None:
        feature_service.set_state(db, name, payload.state)

    db.flush()
    after = _flag_out(db, name)
    record_admin_audit(
        db, actor=user, action="update", subject_type="feature_flag",
        subject_id=name, subject_label=name,
        details={"before": before.model_dump(), "after": after.model_dump()},
    )
    db.commit()
    return after
