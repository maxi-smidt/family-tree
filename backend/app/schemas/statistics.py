"""Schemas for built-in statistics reports."""

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


class MemberYear(BaseModel):
    """A person pinned to a year — e.g. the earliest recorded birth."""

    member_id: str
    first_name: str | None = None
    last_name: str | None = None
    year: int
    place: str | None = None


class LifeSpan(BaseModel):
    member_id: str
    first_name: str | None = None
    last_name: str | None = None
    gender: str | None = None
    birth_year: int
    death_year: int
    age: int


class StatisticsReport(BaseModel):
    workspace_id: str
    total_members: int
    members_with_birth_date: int
    members_with_death_date: int
    average_lifespan: float | None
    gender_distribution: GenderDistribution
    birth_death_by_decade: list[DecadeCount]
    lifespan_distribution: list[AgeGroup]
    top_first_names: list[NameCount]
    top_last_names: list[NameCount]
    # Added for the statistics overview; defaults keep older cached reports
    # and older clients valid.
    living_count: int = 0
    members_with_birthplace: int = 0
    members_with_photo: int = 0
    earliest_birth: MemberYear | None = None
    top_birthplaces: list[NameCount] = []
    longest_lives: list[LifeSpan] = []
