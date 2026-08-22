"""Tests for the safe custom-widget aggregation endpoint (issue #570)."""

import re
from pathlib import Path
from typing import get_args

from app.schemas.statistics import (
    WidgetChartType,
    WidgetDimensionId,
    WidgetMeasureId,
)
from app.services.system import feature_service
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _url(tree_id: str) -> str:
    return f"{API}/trees/{tree_id}/statistics/widgets/aggregate"


def _payload(
    *,
    scope: str = "linked",
    dimension_id: str = "gender",
    measure_id: str = "count",
    breakdown_id: str | None = None,
) -> dict:
    return {
        "scope": scope,
        "widgets": [
            {
                "id": "custom:test",
                "chartType": "bar",
                "dimensionId": dimension_id,
                "measureId": measure_id,
                "breakdownId": breakdown_id,
            }
        ],
    }


def _values_by_category(body: dict) -> dict[str, dict[str, float]]:
    widget = body["widgets"][0]
    return {row["category"]: row["values"] for row in widget["data"]}


def _bridge_pair(db, tree_a, member_a_id, tree_b, member_b_id, **kw):
    first = add_member(db, tree_a, member_a_id, linked_tree_id=tree_b.id, **kw)
    second = add_member(db, tree_b, member_b_id, linked_tree_id=tree_a.id, **kw)
    first.linked_member_id = member_b_id
    second.linked_member_id = member_a_id
    db.commit()


def test_linked_widget_uses_reachable_trees_and_deduplicates_bridges(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    linked = make_tree(db, user, "Linked")
    add_member(db, main, "m1", gender="f")
    _bridge_pair(db, main, "bridge-a", linked, "bridge-b", gender="m")
    add_member(db, linked, "m2", gender="m")

    res = client.post(_url(main.id), json=_payload(), headers=auth(user))

    assert res.status_code == 200
    values = _values_by_category(res.json())
    assert values["m"]["__value__"] == 2
    assert values["f"]["__value__"] == 1
    assert sum(row["__value__"] for row in values.values()) == 3


def test_linked_widget_excludes_unreadable_trees(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private = make_tree(db, stranger, "Private")
    add_member(db, main, "m1", gender="m")
    add_member(db, main, "link", gender="m", linked_tree_id=private.id)
    add_member(db, private, "hidden", gender="f")

    res = client.post(_url(main.id), json=_payload(), headers=auth(owner))

    assert res.status_code == 200
    values = _values_by_category(res.json())
    assert values == {"m": {"__value__": 2}}


def test_linked_widget_includes_tree_shared_with_viewer(client, db):
    owner = make_user(db, "alice")
    friend = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    shared = make_tree(db, friend, "Shared")
    share(db, shared, owner, "viewer")
    add_member(db, main, "link", gender="m", linked_tree_id=shared.id)
    add_member(db, shared, "visible", gender="f")

    res = client.post(_url(main.id), json=_payload(), headers=auth(owner))

    assert res.status_code == 200
    assert _values_by_category(res.json()) == {
        "m": {"__value__": 1},
        "f": {"__value__": 1},
    }


def test_unknown_widget_dimension_or_measure_is_rejected(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    bad_dimension = _payload(dimension_id="not-a-field")
    bad_measure = _payload(measure_id="sum-salary")

    bad_dimension_response = client.post(
        _url(tree.id), json=bad_dimension, headers=auth(user)
    )
    bad_measure_response = client.post(
        _url(tree.id), json=bad_measure, headers=auth(user)
    )

    assert bad_dimension_response.status_code == 422
    assert bad_measure_response.status_code == 422


def test_linked_widget_returns_404_when_tree_links_are_off(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        res = client.post(_url(tree.id), json=_payload(), headers=auth(user))
        assert res.status_code == 404
    finally:
        feature_service.set_state(db, "tree_links", "on")
        db.commit()


def test_widget_caps_categories_and_breakdown_series(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for index in range(20):
        add_member(
            db,
            tree,
            f"m-{index}",
            first_name=f"Name {index}",
            last_name="Same",
        )

    categories = client.post(
        _url(tree.id),
        json=_payload(scope="tree", dimension_id="first-name", breakdown_id="last-name"),
        headers=auth(user),
    )
    assert categories.status_code == 200
    assert len(categories.json()["widgets"][0]["data"]) == 12

    for index in range(8):
        add_member(db, tree, f"series-{index}", gender="m", first_name=f"Series {index}")
    series = client.post(
        _url(tree.id),
        json=_payload(scope="tree", dimension_id="gender", breakdown_id="first-name"),
        headers=auth(user),
    )
    assert series.status_code == 200
    assert len(series.json()["widgets"][0]["series"]) == 6


def _registry_ids(source: str, start: str, end: str) -> set[str]:
    section = source.split(start, maxsplit=1)[1].split(end, maxsplit=1)[0]
    return set(re.findall(r'^\s*id: "([^"]+)"', section, re.MULTILINE))


def test_widget_registries_match_the_frontend_contract():
    """Guard the duplicate bucketing registries required by server pivots."""
    source = (
        Path(__file__).resolve().parents[2]
        / "frontend/src/components/view/statistics-view/customWidgets.ts"
    ).read_text()

    dimension_ids = _registry_ids(
        source, "export const DIMENSION_REGISTRY", "export const DIMENSION_MAP"
    )
    measure_ids = _registry_ids(
        source, "export const MEASURE_REGISTRY", "export const MEASURE_MAP"
    )
    chart_types = set(
        re.findall(
            r'"([^"]+)"',
            source.split("export const CHART_TYPES", maxsplit=1)[1].split(
                ";", maxsplit=1
            )[0],
        )
    )

    assert dimension_ids == set(get_args(WidgetDimensionId))
    assert measure_ids == set(get_args(WidgetMeasureId))
    assert chart_types == set(get_args(WidgetChartType))
