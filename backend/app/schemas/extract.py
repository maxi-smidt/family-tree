"""Shared branch-direction type for section previews.

Originally introduced for the (now-removed) sub-tree extraction endpoint;
``app.services.workspaces.subtree_selection`` and ``app.services.sections``
still use it to describe which branch a section preview pulls in.
"""

from __future__ import annotations

from typing import Literal

# "direct_family" (default): the root's family of origin — parents,
# siblings and their branches, with married-in spouses; the root's own
# children never move. See services/workspaces/subtree_selection.py for the
# exact algorithm.
# "partnership": the root's partner(s), the partner's family, and the
# children the root shares with them.
Direction = Literal["direct_family", "partnership"]
