"""Instance-wide feature flags: registry, resolution, and admin updates.

The registry below is the single source of truth for *which* flags exist —
keeping it in code (not the DB) means a flag can never be orphaned and the
frontend catalog (``frontend/src/lib/features.ts``) can mirror it 1:1.

Each flag has a global state stored in ``app_settings`` under
``feature.<name>``:

- ``on``    — enabled for everyone (every flag's default),
- ``off``   — disabled for everyone (the kill switch),
- ``beta``  — enabled only for users on the flag's allowlist
  (``feature_flag_overrides`` rows).

Resolution is per request: ``on``/``off`` ignore the allowlist; ``beta`` is
enabled iff the current user is listed. Flags are per-instance only — there is
deliberately no per-tree override.

Adding a flag for a new feature:
1. add its name + default here,
2. gate its routers with ``Depends(require_feature("<name>"))`` (app/api/deps.py),
3. mirror the name in ``frontend/src/lib/features.ts`` and gate the UI entry
   points with ``useFeature("<name>")``,
4. add ``admin.features.names.<name>`` (+ description) to every locale.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, FeatureFlagOverride, User
from app.schemas.setting import FeatureFlagOut, FeatureState
from app.services.settings_service import get_setting, set_setting

# Registry: flag name -> default state when no app_settings row exists.
# Core member/tree CRUD is intentionally not flaggable.
FEATURES: dict[str, FeatureState] = {
    "gallery": "on",
    "stories": "on",
    "events": "on",
    "activity_log": "on",
    "quality_report": "on",
    "statistics": "on",
    "virtual_views": "on",
    "gedcom": "on",
    "sharing_invites": "on",
}

_SETTING_PREFIX = "feature."

_VALID_STATES: set[str] = {"on", "off", "beta"}


def _setting_key(feature: str) -> str:
    return f"{_SETTING_PREFIX}{feature}"


def get_state(db: Session, feature: str) -> FeatureState:
    """Effective global state of a flag; unknown stored values fall back to
    the registry default so a bad row can never brick a feature."""
    default = FEATURES[feature]
    value = get_setting(db, _setting_key(feature))
    if value in _VALID_STATES:
        return value  # type: ignore[return-value]
    return default


def get_allowlist(db: Session, feature: str) -> list[str]:
    return list(
        db.scalars(
            select(FeatureFlagOverride.user_id).where(
                FeatureFlagOverride.feature == feature
            )
        ).all()
    )


def is_enabled(db: Session, feature: str, user: User) -> bool:
    state = get_state(db, feature)
    if state == "on":
        return True
    if state == "off":
        return False
    return (
        db.get(FeatureFlagOverride, (feature, user.id)) is not None
    )


def enabled_for(db: Session, user: User) -> list[str]:
    """All flags enabled for ``user``, in registry order (two queries total)."""
    keys = [_setting_key(name) for name in FEATURES]
    rows = db.scalars(select(AppSetting).where(AppSetting.key.in_(keys))).all()
    stored = {row.key: row.value for row in rows}
    allowed = set(
        db.scalars(
            select(FeatureFlagOverride.feature).where(
                FeatureFlagOverride.user_id == user.id
            )
        ).all()
    )

    enabled: list[str] = []
    for name, default in FEATURES.items():
        state = stored.get(_setting_key(name))
        if state not in _VALID_STATES:
            state = default
        if state == "on" or (state == "beta" and name in allowed):
            enabled.append(name)
    return enabled


def get_flags_out(db: Session) -> list[FeatureFlagOut]:
    return [
        FeatureFlagOut(
            name=name,
            state=get_state(db, name),
            allowlist=get_allowlist(db, name),
        )
        for name in FEATURES
    ]


def set_state(db: Session, feature: str, state: FeatureState) -> None:
    set_setting(db, _setting_key(feature), state)


def set_allowlist(db: Session, feature: str, user_ids: list[str]) -> None:
    """Replace the flag's allowlist with ``user_ids`` (assumed validated)."""
    existing = db.scalars(
        select(FeatureFlagOverride).where(FeatureFlagOverride.feature == feature)
    ).all()
    wanted = set(user_ids)
    for row in existing:
        if row.user_id not in wanted:
            db.delete(row)
    current = {row.user_id for row in existing}
    for user_id in wanted - current:
        db.add(FeatureFlagOverride(feature=feature, user_id=user_id))
