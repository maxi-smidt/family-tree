"""Member overlap detection and match-group persistence for virtual views.

Overlap is determined by deterministic key comparison — no ML or fuzzy matching.
Two normalisation tiers:

  Tier 1 (year-anchored): (fold(first_name), fold(last_name), birth_year)
      — applies when birth_year can be extracted from date_of_birth.
  Tier 2 (year-less):     (fold(first_name), fold(last_name), gender or "o")
      — fallback when birth_year is absent for the member.

A key is excluded from matching when a *single* source tree has 2+ members
with the same key (same-named twins / duplicates — ambiguous; never auto-merge).

A match group spans members from ≥2 distinct workspaces that share the same key.
Groups are persisted in ``virtual_view_member_matches``; the group_id is a
deterministic sha256 hash of the sorted member ids so recomputing with identical
membership yields the same id (position overlays remain valid).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import Member
from app.models.virtual_view import VirtualViewMemberMatch, VirtualViewPosition
from app.services.virtual_views.virtual_view_sources import flatten_workspace_ids

if TYPE_CHECKING:
    from app.models.virtual_view import VirtualView


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------


def fold(s: str | None) -> str:
    """NFKD + strip combining marks + casefold + collapse whitespace."""
    raw = unicodedata.normalize("NFKD", s or "")
    stripped = "".join(c for c in raw if not unicodedata.combining(c))
    return " ".join(stripped.casefold().split())


def birth_year(date_str: str | None) -> str | None:
    """Return the first 4-digit year found in a free-form date string, or None."""
    if not date_str:
        return None
    m = re.search(r"\b(\d{4})\b", date_str)
    return m.group(1) if m else None


def _member_keys(m: Member) -> list[tuple]:
    """Return the 1–2 matching keys for a member (Tier 1 preferred)."""
    fn = fold(m.first_name)
    ln = fold(m.last_name)
    if not fn and not ln:
        return []
    by = birth_year(m.date_of_birth)
    if by is not None:
        return [(fn, ln, by)]
    # Fall back to gender-based tier when no year is available.
    gender = m.gender or "o"
    return [(fn, ln, gender)]


def group_id_for(member_ids: list[str]) -> str:
    payload = ":".join(sorted(member_ids))
    return "vm_" + hashlib.sha256(payload.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------


def compute_match_groups(
    db: Session, source_workspace_ids: list[str]
) -> list[list[Member]]:
    """Return groups of members (one list per group) that overlap across workspaces.

    Each group contains members from ≥2 distinct source workspaces that share the
    same normalised key. Members whose key is ambiguous within a single tree
    (twins / duplicates) are excluded.
    """
    members = list(
        db.scalars(
            select(Member).where(Member.workspace_id.in_(source_workspace_ids))
        ).all()
    )

    # Map key → { workspace_id → [member, ...] }
    key_buckets: dict[tuple, dict[str, list[Member]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for m in members:
        for key in _member_keys(m):
            key_buckets[key][m.workspace_id].append(m)

    groups: list[list[Member]] = []
    for _key, by_tree in key_buckets.items():
        # Exclude keys that are ambiguous within any single tree.
        if any(len(ms) > 1 for ms in by_tree.values()):
            continue
        # Must span ≥2 distinct workspaces to be a match group.
        if len(by_tree) < 2:
            continue
        # One member per tree in a group (ambiguity guard ensures this).
        groups.append([ms[0] for ms in by_tree.values()])

    return groups


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def persist_matches(db: Session, view: VirtualView) -> int:
    """Recompute and persist match groups for *view*.

    Deletes all existing match rows for the view, runs the matching algorithm,
    inserts fresh rows, prunes orphaned position overlays (nodes whose group_id
    changed), and stamps ``matches_computed_at``.

    Returns the number of match groups found.
    """
    # Sources may be real workspaces or nested virtual views — flatten the DAG to the
    # underlying real tree ids before matching so nesting behaves like a flat
    # composite of the same workspaces.
    source_ids = flatten_workspace_ids(db, view)

    # Wipe old match rows (cascade would only fire on member deletion; we also
    # need a clean slate when sources change).
    db.execute(
        VirtualViewMemberMatch.__table__.delete().where(
            VirtualViewMemberMatch.view_id == view.id
        )
    )

    groups = compute_match_groups(db, source_ids)
    source_order = {tid: i for i, tid in enumerate(source_ids)}

    valid_node_ids: set[str] = set()

    for group in groups:
        member_ids = [m.id for m in group]
        gid = group_id_for(member_ids)
        valid_node_ids.add(gid)
        # Primary = member whose tree has the lowest position in source_order.
        primary = min(group, key=lambda m: source_order.get(m.workspace_id, 999))
        for m in group:
            db.add(
                VirtualViewMemberMatch(
                    view_id=view.id,
                    member_id=m.id,
                    group_id=gid,
                    is_primary=(m.id == primary.id),
                )
            )

    # Prune position overlay rows for nodes that no longer exist.
    all_pos = list(
        db.scalars(
            select(VirtualViewPosition).where(VirtualViewPosition.view_id == view.id)
        ).all()
    )
    for pos in all_pos:
        if pos.node_id not in valid_node_ids:
            db.delete(pos)

    view.matches_computed_at = utcnow_iso()
    return len(groups)
