"""Overview fields of the statistics report (living count, earliest birth,
birthplaces, longest lives, completeness counts)."""

from app.models.family import Member
from app.services.workspaces.statistics import compute_statistics


def _member(mid: str, first: str, **kw) -> Member:
    return Member(id=mid, workspace_id="ws", first_name=first, last_name="Gruber", **kw)


def test_overview_fields():
    members = [
        _member("a", "Franz", date_of_birth="1919-12-01", date_of_death="1988-05-09",
                birthplace="St. Pölten", gender="m"),
        _member("b", "Anna", date_of_birth="1926-02-11", date_of_death="2015-08-22",
                birthplace="Tulln", gender="f", image_data="/media/a.jpg"),
        _member("c", "Lena", date_of_birth="2006-12-01", birthplace="Wien"),
        _member("d", "Max", date_of_birth="2003-06-10", birthplace="Wien"),
        # Flagged deceased without a death date: not living, no lifespan.
        _member("e", "Karl", deceased=True),
        # Free-text date with a normalised sort key.
        _member("f", "Rosa", date_of_birth="ABT 1900", date_of_birth_sort="1900-00-00"),
    ]
    report = compute_statistics(members, "ws")

    assert report.living_count == 3  # Lena, Max, Rosa
    assert report.members_with_birthplace == 4
    assert report.members_with_photo == 1
    assert report.earliest_birth is not None
    assert report.earliest_birth.member_id == "f"
    assert report.earliest_birth.year == 1900
    assert [(p.name, p.count) for p in report.top_birthplaces][0] == ("Wien", 2)
    assert [life.member_id for life in report.longest_lives] == ["b", "a"]
    assert report.longest_lives[0].age == 89


def test_longest_lives_capped_and_stable():
    members = [
        _member(str(i), f"P{i}", date_of_birth=f"{1900 + i}", date_of_death=f"{1970 + i}")
        for i in range(12)
    ]
    report = compute_statistics(members, "ws")
    assert len(report.longest_lives) == 8
    # All aged 70 — ties keep birth order.
    assert [life.birth_year for life in report.longest_lives] == list(range(1900, 1908))


def test_empty_workspace_has_empty_overview():
    report = compute_statistics([], "ws")
    assert report.living_count == 0
    assert report.earliest_birth is None
    assert report.top_birthplaces == []
    assert report.longest_lives == []
