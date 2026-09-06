"""Statistics endpoint — aggregate insights for a family tree."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_workspace
from app.db.session import get_db
from app.models import Workspace
from app.models.family import Member
from app.schemas.statistics import (
    CustomWidgetAggregateConfig,
    CustomWidgetAggregateRequest,
    CustomWidgetAggregateResponse,
    CustomWidgetAggregateRow,
    CustomWidgetAggregation,
    StatisticsReport,
    WidgetDimensionId,
    WidgetMeasureId,
)
from app.services.cache import (
    STATS_TTL_SECONDS,
    cache_get_json,
    cache_set_json,
    stats_key,
)
from app.services.workspaces.statistics import AGE_BUCKETS, compute_statistics
from app.services.workspaces.statistics import decade_label as _decade_label
from app.services.workspaces.statistics import extract_year as _extract_year

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["statistics"],
)

WIDGET_MAX_CATEGORIES = 12
WIDGET_MAX_BREAKDOWN_SERIES = 6
_GENDER_ORDER = {"m": 0, "f": 1, "o": 2, "unknown": 3}
_DECEASED_STATUS_ORDER = {"living": 0, "deceased": 1}
_AGE_BUCKET_ORDER = {label: i for i, (_, _, label) in enumerate(AGE_BUCKETS)}


def _widget_birth_year(member: Member) -> int | None:
    """Match the frontend's preferred sort-key then display-date lookup."""
    return _extract_year(member.date_of_birth_sort) or _extract_year(member.date_of_birth)


def _widget_death_year(member: Member) -> int | None:
    """Match the frontend's preferred sort-key then display-date lookup."""
    return _extract_year(member.date_of_death_sort) or _extract_year(member.date_of_death)


def _widget_age_at_death(member: Member) -> int | None:
    birth_year = _widget_birth_year(member)
    death_year = _widget_death_year(member)
    if birth_year is not None and death_year is not None and death_year >= birth_year:
        return death_year - birth_year
    return None


def _non_empty(value: str | None) -> str | None:
    """Return a trimmed string only when it contains a visible value."""
    if not value:
        return None
    trimmed = value.strip()
    return trimmed or None


def _widget_dimension_value(member: Member, dimension: WidgetDimensionId) -> str | None:
    """Bucket a member using one known custom-widget dimension.

    This intentional branch table is the backend allowlist boundary: dimensions
    are ids, not user-provided fields, so nothing here performs dynamic
    attribute access or constructs SQL from request input.
    """
    if dimension == "gender":
        gender = (member.gender or "").lower()
        return gender if gender in _GENDER_ORDER else "unknown"
    if dimension == "birth-decade":
        year = _widget_birth_year(member)
        return _decade_label(year) if year is not None else None
    if dimension == "death-decade":
        year = _widget_death_year(member)
        return _decade_label(year) if year is not None else None
    if dimension == "birth-year":
        year = _widget_birth_year(member)
        return str(year) if year is not None else None
    if dimension == "age-at-death":
        age = _widget_age_at_death(member)
        if age is None:
            return None
        for lower, upper, label in AGE_BUCKETS:
            if lower <= age <= upper:
                return label
        return None
    if dimension == "birthplace":
        return _non_empty(member.birthplace)
    if dimension == "hometown":
        return _non_empty(member.hometown)
    if dimension == "cemetery":
        return _non_empty(member.cemetery)
    if dimension == "first-name":
        return _non_empty(member.first_name)
    if dimension == "last-name":
        return _non_empty(member.last_name)
    if dimension == "deceased-status":
        return "deceased" if member.deceased or member.date_of_death else "living"
    if dimension == "academic-title":
        return "with" if _non_empty(member.academic_title) else "without"
    raise ValueError(f"Unsupported widget dimension: {dimension}")


def _widget_measure_value(
    members: list[Member], measure: WidgetMeasureId
) -> float | None:
    """Compute one known custom-widget measure for a member group."""
    if measure == "count":
        return float(len(members))

    if measure == "avg-lifespan":
        ages = [
            age for member in members if (age := _widget_age_at_death(member)) is not None
        ]
    elif measure == "avg-age":
        current_year = date.today().year
        ages = []
        for member in members:
            birth_year = _widget_birth_year(member)
            if birth_year is None:
                continue
            death_year = _widget_death_year(member)
            end_year = death_year if death_year is not None else current_year
            if member.deceased and death_year is None:
                continue
            if end_year >= birth_year:
                ages.append(end_year - birth_year)
    else:
        raise ValueError(f"Unsupported widget measure: {measure}")

    if not ages:
        return None
    # JavaScript's Math.round rounds .5 up, unlike Python's banker's rounding.
    return math.floor((sum(ages) / len(ages)) * 10 + 0.5) / 10


def _widget_natural_sort_key(
    dimension: WidgetDimensionId, category: str
) -> tuple[int, int | str]:
    if dimension == "gender":
        return (0, _GENDER_ORDER.get(category, len(_GENDER_ORDER)))
    if dimension in {"birth-decade", "death-decade", "birth-year"}:
        match = re.match(r"[+-]?\d+", category)
        return (0, int(match.group())) if match else (1, category)
    if dimension == "age-at-death":
        return (0, _AGE_BUCKET_ORDER.get(category, len(_AGE_BUCKET_ORDER)))
    if dimension == "deceased-status":
        return (0, _DECEASED_STATUS_ORDER.get(category, len(_DECEASED_STATUS_ORDER)))
    if dimension == "academic-title":
        return (0, 0 if category == "with" else 1)
    return (0, category)


def _is_value_desc_dimension(dimension: WidgetDimensionId) -> bool:
    return dimension in {
        "birthplace",
        "hometown",
        "cemetery",
        "first-name",
        "last-name",
    }


def compute_custom_widget_aggregation(
    members: list[Member], config: CustomWidgetAggregateConfig
) -> CustomWidgetAggregation:
    """Pivot known member fields into a capped, chart-ready widget dataset."""
    dimension = config.dimension_id
    measure = config.measure_id
    breakdown = (
        config.breakdown_id
        if config.breakdown_id and config.breakdown_id != dimension
        else None
    )
    groups: dict[str, dict[str, list[Member]]] = {}

    for member in members:
        category = _widget_dimension_value(member, dimension)
        if category is None:
            continue
        series = (
            _widget_dimension_value(member, breakdown)
            if breakdown is not None
            else "__value__"
        )
        if series is None:
            continue
        groups.setdefault(category, {}).setdefault(series, []).append(member)

    categories = list(groups)
    if _is_value_desc_dimension(dimension):
        categories.sort(
            key=lambda category: (
                -(
                    _widget_measure_value(
                        [
                            member
                            for bucket in groups[category].values()
                            for member in bucket
                        ],
                        measure,
                    )
                    or 0
                ),
                category,
            )
        )
        categories = categories[:WIDGET_MAX_CATEGORIES]
    else:
        categories.sort(
            key=lambda category: _widget_natural_sort_key(dimension, category)
        )

    if breakdown is None:
        series = ["__value__"]
    else:
        totals: dict[str, int] = defaultdict(int)
        for by_series in groups.values():
            for series, bucket in by_series.items():
                totals[series] += len(bucket)
        series = [
            key
            for key, _ in sorted(totals.items(), key=lambda item: (-item[1], item[0]))[
                :WIDGET_MAX_BREAKDOWN_SERIES
            ]
        ]

    data = [
        CustomWidgetAggregateRow(
            category=category,
            values={
                series_key: _widget_measure_value(
                    groups[category].get(series_key, []), measure
                )
                or 0
                for series_key in series
            },
        )
        for category in categories
    ]
    return CustomWidgetAggregation(id=config.id, data=data, series=series)


def _load_and_compute(db: Session, workspace_id: str) -> StatisticsReport:
    """Query the tree's members and build the report (blocking, sync).

    Kept separate so the route can run it in the threadpool — the DB query
    and the O(n) aggregation must not block the event loop.
    """
    members = list(
        db.scalars(select(Member).where(Member.workspace_id == workspace_id)).all()
    )
    return compute_statistics(members, workspace_id)


@router.get("/statistics", response_model=StatisticsReport)
async def get_statistics(
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
) -> StatisticsReport:
    """Return aggregate statistics for the tree. Read-only, scoped by workspace_id.

    When Redis is configured the result is cached per tree for
    ``STATS_TTL_SECONDS`` seconds and invalidated on member/relation writes.
    When Redis is not configured the statistics are always recomputed — the
    original behaviour is preserved exactly.
    """
    key = stats_key(tree.id)

    # --- cache hit -----------------------------------------------------------
    cached = await cache_get_json(key)
    if cached is not None:
        try:
            return StatisticsReport.model_validate(cached)
        except Exception:
            # Corrupt cached value — fall through and recompute.
            pass

    # --- cache miss: query DB and compute ------------------------------------
    # Run the blocking DB query + aggregation in the threadpool so the event
    # loop stays free (this is the hot path when Redis is not configured).
    report = await run_in_threadpool(_load_and_compute, db, tree.id)

    # Store the result; failures are silently swallowed inside cache_set_json.
    await cache_set_json(key, report.model_dump(mode="json"), STATS_TTL_SECONDS)

    return report


def _load_custom_widget_aggregations(
    db: Session,
    anchor: Workspace,
    payload: CustomWidgetAggregateRequest,
) -> CustomWidgetAggregateResponse:
    """Load the tree's members once, then calculate every requested pivot."""
    members = list(
        db.scalars(
            select(Member).where(Member.workspace_id == anchor.id).order_by(Member.id)
        ).all()
    )

    return CustomWidgetAggregateResponse(
        widgets=[
            compute_custom_widget_aggregation(members, config)
            for config in payload.widgets
        ]
    )


@router.post(
    "/statistics/widgets/aggregate",
    response_model=CustomWidgetAggregateResponse,
)
async def get_custom_widget_aggregations(
    payload: CustomWidgetAggregateRequest,
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
) -> CustomWidgetAggregateResponse:
    """Return safe, capped pivots for custom statistics widgets."""
    return await run_in_threadpool(_load_custom_widget_aggregations, db, tree, payload)
