// ---------------------------------------------------------------------------
// Shared relation-type constants used across the app.
// ---------------------------------------------------------------------------

/** Relation types that indicate a couple bond (partner/married/divorced). */
export const COUPLE_RELATION_TYPES = new Set([
  "married",
  "partner",
  "divorced",
]);

/** Canonical relation type string for step-parent edges. */
export const STEP_PARENT_RELATION_TYPE = "step-parent";

/** Canonical relation type string for step-sibling edges. */
export const STEP_SIBLING_RELATION_TYPE = "step-sibling";
