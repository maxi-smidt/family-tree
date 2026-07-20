"""Data-quality checks for a family tree."""

import hashlib
from collections import defaultdict

from app.models.family import Member, Relation

# Minimum/maximum plausible age of a parent at their child's birth.
_MIN_PARENT_AGE = 10
_MAX_PARENT_AGE = 100

# A child can legitimately be born shortly after their *father's* death
# (a posthumous birth, up to ~9 months later). Dates here are year-only, so a
# one-year grace window is allowed for fathers and unknown-gender parents. A
# birth after the *mother's* death is not biologically possible, so mothers get
# no grace.
_POSTHUMOUS_BIRTH_GRACE_YEARS = 1


def _year(date_str: str | None) -> int | None:
    if not date_str:
        return None
    try:
        return int(date_str.split("-")[0])
    except (ValueError, IndexError):
        return None


def issue_id_for(issue_type: str, member_ids: list[str]) -> str:
    """Deterministic id for an issue, derived from its type and members.

    Issues are recomputed fresh on every request rather than stored, so this
    id is what lets a dismissal survive across requests: as long as the same
    underlying data produces the same issue, it hashes to the same id.
    """
    key = f"{issue_type}|{','.join(sorted(member_ids))}"
    return hashlib.sha256(key.encode()).hexdigest()[:32]


def run_quality_checks(
    members: list[Member],
    relations: list[Relation],
) -> list[dict]:
    issues: list[dict] = []
    member_map = {m.id: m for m in members}

    # --- 1. Birth-after-death ---
    for m in members:
        birth = _year(m.date_of_birth)
        death = _year(m.date_of_death)
        if birth is not None and death is not None and birth > death:
            issues.append(
                {
                    "issue_type": "birth_after_death",
                    "severity": "error",
                    "member_ids": [m.id],
                    "description": f"Birth year ({birth}) is after death year ({death}).",
                }
            )

    # --- 2. Parent–child age-gap anomalies ---
    # Relation direction: from_member_id = child, to_member_id = parent
    parent_pairs: list[tuple[str, str]] = [
        (r.to_member_id, r.from_member_id)  # (parent_id, child_id)
        for r in relations
        if r.relation_type == "parent"
    ]

    for parent_id, child_id in parent_pairs:
        parent = member_map.get(parent_id)
        child = member_map.get(child_id)
        if parent is None or child is None:
            continue
        parent_birth = _year(parent.date_of_birth)
        parent_death = _year(parent.date_of_death)
        child_birth = _year(child.date_of_birth)

        # Child born after the parent had already died. Fathers (and parents of
        # unknown gender) get a small posthumous-birth grace window; mothers get
        # none, since a birth after the mother's death is impossible.
        if parent_death is not None and child_birth is not None:
            is_mother = (parent.gender or "").lower() == "f"
            grace = 0 if is_mother else _POSTHUMOUS_BIRTH_GRACE_YEARS
            if child_birth > parent_death + grace:
                issues.append(
                    {
                        "issue_type": "child_after_parent_death",
                        "severity": "error",
                        "member_ids": [parent_id, child_id],
                        "description": (
                            f"Child was born ({child_birth}) after the "
                            f"parent's death year ({parent_death})."
                        ),
                    }
                )

        if parent_birth is None or child_birth is None:
            continue
        age_at_birth = child_birth - parent_birth
        if age_at_birth < 0:
            issues.append(
                {
                    "issue_type": "child_older_than_parent",
                    "severity": "error",
                    "member_ids": [parent_id, child_id],
                    "description": (
                        f"Child's birth year ({child_birth}) is before "
                        f"parent's birth year ({parent_birth})."
                    ),
                }
            )
        elif age_at_birth < _MIN_PARENT_AGE:
            issues.append(
                {
                    "issue_type": "parent_too_young",
                    "severity": "warning",
                    "member_ids": [parent_id, child_id],
                    "description": (
                        f"Parent was only {age_at_birth} year(s) old when "
                        f"child was born ({child_birth})."
                    ),
                }
            )
        elif age_at_birth > _MAX_PARENT_AGE:
            issues.append(
                {
                    "issue_type": "parent_too_old",
                    "severity": "warning",
                    "member_ids": [parent_id, child_id],
                    "description": (
                        f"Parent was {age_at_birth} years old when "
                        f"child was born ({child_birth})."
                    ),
                }
            )

    # --- 3. Relationship cycles (parent-chain) ---
    # Build child→parents adjacency for traversal.
    parents_of: dict[str, set[str]] = defaultdict(set)
    for parent_id, child_id in parent_pairs:
        parents_of[child_id].add(parent_id)

    visited: set[str] = set()
    on_stack: set[str] = set()
    cycle_members: set[str] = set()

    def _dfs(node: str) -> bool:
        visited.add(node)
        on_stack.add(node)
        for ancestor in parents_of.get(node, set()):
            if ancestor not in visited:
                if _dfs(ancestor):
                    cycle_members.update([node, ancestor])
                    return True
            elif ancestor in on_stack:
                cycle_members.update([node, ancestor])
                return True
        on_stack.discard(node)
        return False

    for m in members:
        if m.id not in visited:
            _dfs(m.id)

    if cycle_members:
        issues.append(
            {
                "issue_type": "relationship_cycle",
                "severity": "error",
                "member_ids": sorted(cycle_members),
                "description": "A cycle exists in the parent-child relationships.",
            }
        )

    # --- 4. Duplicate-name candidates ---
    name_groups: dict[str, list[str]] = defaultdict(list)
    for m in members:
        first = (m.first_name or "").strip().lower()
        last = (m.last_name or "").strip().lower()
        if first or last:
            name_groups[f"{first}|{last}"].append(m.id)

    for _key, ids in name_groups.items():
        if len(ids) > 1:
            issues.append(
                {
                    "issue_type": "duplicate_candidate",
                    "severity": "warning",
                    "member_ids": ids,
                    "description": f"{len(ids)} members share the same full name.",
                }
            )

    # --- 5. Disconnected members (no relations at all) ---
    if len(members) > 1:
        connected: set[str] = set()
        for r in relations:
            connected.add(r.from_member_id)
            connected.add(r.to_member_id)
        for m in members:
            if m.id not in connected:
                issues.append(
                    {
                        "issue_type": "disconnected_member",
                        "severity": "warning",
                        "member_ids": [m.id],
                        "description": "Member has no relationships.",
                    }
                )

    for issue in issues:
        issue["id"] = issue_id_for(issue["issue_type"], issue["member_ids"])

    return issues
