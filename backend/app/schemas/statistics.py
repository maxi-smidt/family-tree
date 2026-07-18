"""Schemas for statistics reports and custom-widget aggregations."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.base import FamilyTreeBaseModel

# These are deliberately closed registries.  The aggregation endpoint maps
# every accepted value to explicit Python code; it never accepts a field name
# or query fragment from the client.  ``test_statistics_widgets.py`` checks
# that they stay in lock-step with the frontend widget registries.
WidgetChartType = Literal["bar", "pie", "line", "area"]
WidgetDimensionId = Literal[
    "gender",
    "birth-decade",
    "death-decade",
    "birth-year",
    "age-at-death",
    "birthplace",
    "hometown",
    "cemetery",
    "first-name",
    "last-name",
    "deceased-status",
    "academic-title",
]
WidgetMeasureId = Literal["count", "avg-lifespan", "avg-age"]


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


class CustomWidgetAggregateConfig(FamilyTreeBaseModel):
    """The safe, serializable portion of a custom-widget configuration."""

    id: str = Field(min_length=1, max_length=128)
    chart_type: WidgetChartType
    dimension_id: WidgetDimensionId
    measure_id: WidgetMeasureId
    breakdown_id: WidgetDimensionId | None = None


class CustomWidgetAggregateRequest(FamilyTreeBaseModel):
    """Batch widget pivots so one scope change produces one API request."""

    scope: Literal["tree", "linked"] = "tree"
    widgets: list[CustomWidgetAggregateConfig] = Field(min_length=1, max_length=100)


class CustomWidgetAggregateRow(BaseModel):
    """One raw category with values keyed by its raw series ids."""

    category: str
    values: dict[str, float]


class CustomWidgetAggregation(BaseModel):
    id: str
    data: list[CustomWidgetAggregateRow]
    series: list[str]


class CustomWidgetAggregateResponse(BaseModel):
    widgets: list[CustomWidgetAggregation]
