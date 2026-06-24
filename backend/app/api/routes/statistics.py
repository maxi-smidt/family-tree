"""Statistics endpoint — aggregate insights for a family tree."""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, require_feature
from app.db.session import get_db
from app.models import Tree
from app.models.family import Member
from app.schemas.statistics import (
    AgeGroup,
    DecadeCount,
    GenderDistribution,
    NameCount,
    StatisticsReport,
)
from app.services.cache import (
    STATS_TTL_SECONDS,
    cache_get_json,
    cache_set_json,
    stats_key,
)

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["statistics"],
    dependencies=[Depends(require_feature("statistics"))],
)

_YEAR_RE = re.compile(r"\b(\d{4})\b")

AGE_BUCKETS = [
    (0, 9, "0–9"),
    (10, 19, "10–19"),
    (20, 29, "20–29"),
    (30, 39, "30–39"),
    (40, 49, "40–49"),
    (50, 59, "50–59"),
    (60, 69, "60–69"),
    (70, 79, "70–79"),
    (80, 89, "80–89"),
    (90, 99, "90–99"),
    (100, 9999, "100+"),
]


def _extract_year(date_str: str | None) -> int | None:
    if not date_str:
        return None
    m = _YEAR_RE.search(date_str)
    if m:
        return int(m.group(1))
    return None


def _decade_label(year: int) -> str:
    return f"{(year // 10) * 10}s"


def compute_statistics(members: list[Member], tree_id: str) -> StatisticsReport:
    """Build the statistics report from a member list.

    Pure (no DB): shared by the per-tree route and the virtual-view composite,
    which passes the merged/deduplicated members of the flattened sources.
    """
    total = len(members)
    gender_counts: dict[str, int] = {"m": 0, "f": 0, "o": 0, "unknown": 0}
    birth_years: list[int] = []
    death_years: list[int] = []
    lifespans: list[int] = []
    first_name_counter: Counter[str] = Counter()
    last_name_counter: Counter[str] = Counter()

    for m in members:
        # Gender
        g = (m.gender or "").strip().lower()
        if g in ("m", "f", "o"):
            gender_counts[g] += 1
        else:
            gender_counts["unknown"] += 1

        birth_year = _extract_year(m.date_of_birth)
        death_year = _extract_year(m.date_of_death)

        if birth_year:
            birth_years.append(birth_year)
        if death_year:
            death_years.append(death_year)
        if birth_year and death_year and death_year >= birth_year:
            lifespans.append(death_year - birth_year)

        if m.first_name and m.first_name.strip():
            first_name_counter[m.first_name.strip()] += 1
        if m.last_name and m.last_name.strip():
            last_name_counter[m.last_name.strip()] += 1

    # Birth / death by decade
    decade_births: dict[str, int] = defaultdict(int)
    decade_deaths: dict[str, int] = defaultdict(int)
    for y in birth_years:
        decade_births[_decade_label(y)] += 1
    for y in death_years:
        decade_deaths[_decade_label(y)] += 1

    all_decades = sorted(set(decade_births) | set(decade_deaths))
    birth_death_by_decade = [
        DecadeCount(
            decade=d,
            births=decade_births.get(d, 0),
            deaths=decade_deaths.get(d, 0),
        )
        for d in all_decades
    ]

    # Lifespan distribution
    bucket_counts: dict[str, int] = {label: 0 for _, _, label in AGE_BUCKETS}
    for age in lifespans:
        for lo, hi, label in AGE_BUCKETS:
            if lo <= age <= hi:
                bucket_counts[label] += 1
                break

    lifespan_distribution = [
        AgeGroup(range=label, count=bucket_counts[label])
        for _, _, label in AGE_BUCKETS
        if bucket_counts[label] > 0
    ]

    avg_lifespan = (sum(lifespans) / len(lifespans)) if lifespans else None

    return StatisticsReport(
        tree_id=tree_id,
        total_members=total,
        members_with_birth_date=len(birth_years),
        members_with_death_date=len(death_years),
        average_lifespan=round(avg_lifespan, 1) if avg_lifespan is not None else None,
        gender_distribution=GenderDistribution(
            male=gender_counts["m"],
            female=gender_counts["f"],
            other=gender_counts["o"],
            unknown=gender_counts["unknown"],
        ),
        birth_death_by_decade=birth_death_by_decade,
        lifespan_distribution=lifespan_distribution,
        top_first_names=[
            NameCount(name=n, count=c)
            for n, c in first_name_counter.most_common(10)
        ],
        top_last_names=[
            NameCount(name=n, count=c)
            for n, c in last_name_counter.most_common(10)
        ],
    )


def _load_and_compute(db: Session, tree_id: str) -> StatisticsReport:
    """Query the tree's members and build the report (blocking, sync).

    Kept separate so the route can run it in the threadpool — the DB query
    and the O(n) aggregation must not block the event loop.
    """
    members = list(
        db.scalars(select(Member).where(Member.tree_id == tree_id)).all()
    )
    return compute_statistics(members, tree_id)


@router.get("/statistics", response_model=StatisticsReport)
async def get_statistics(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
) -> StatisticsReport:
    """Return aggregate statistics for the tree. Read-only, scoped by tree_id.

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
