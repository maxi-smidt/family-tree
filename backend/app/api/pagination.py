"""Shared pagination helpers for collection endpoints."""

from dataclasses import dataclass

from fastapi import Query
from sqlalchemy.sql import Select

MAX_PAGE_LIMIT = 500


@dataclass(frozen=True)
class Pagination:
    limit: int | None
    offset: int


def pagination_params(
    limit: int | None = Query(default=None, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(default=0, ge=0),
) -> Pagination:
    """Return optional pagination parameters.

    ``limit`` intentionally defaults to ``None`` so existing clients keep the
    current full-list behavior until they opt into pagination.
    """
    return Pagination(limit=limit, offset=offset)


def apply_pagination(statement: Select, pagination: Pagination) -> Select:
    if pagination.offset:
        statement = statement.offset(pagination.offset)
    if pagination.limit is not None:
        statement = statement.limit(pagination.limit)
    return statement
