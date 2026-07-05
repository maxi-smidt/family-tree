"""Schemas for the statistics report."""

from pydantic import BaseModel


class GenderDistribution(BaseModel):
    male: int
    female: int
    other: int
    unknown: int


class DecadeCount(BaseModel):
    decade: str
    births: int
    deaths: int


class AgeGroup(BaseModel):
    range: str
    count: int


class NameCount(BaseModel):
    name: str
    count: int


class StatisticsReport(BaseModel):
    tree_id: str
    total_members: int
    members_with_birth_date: int
    members_with_death_date: int
    average_lifespan: float | None
    gender_distribution: GenderDistribution
    birth_death_by_decade: list[DecadeCount]
    lifespan_distribution: list[AgeGroup]
    top_first_names: list[NameCount]
    top_last_names: list[NameCount]


class CombinedStatisticsReport(StatisticsReport):
    """Statistics aggregated across the anchor tree and its linked trees.

    Same shape as ``StatisticsReport`` (``tree_id`` stays the anchor tree's
    id) plus how many trees were folded in and which ones, so the frontend
    can show "across N trees" without a second request.
    """

    tree_count: int
    included_tree_ids: list[str]
