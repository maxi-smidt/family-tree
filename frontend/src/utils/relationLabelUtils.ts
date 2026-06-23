import { RelationTypeDB } from "@/types/member";

/**
 * Resolve the display label for a relation type using the precedence:
 *   1. `type.label` (admin-set custom label)
 *   2. i18n translation via `tRelation(type.id, { defaultValue: ... })`
 *      with fallback chain: `type.description ?? type.id`
 *
 * @param type   The relation type DB row.
 * @param tRelation  The bound i18next `t` function for the
 *                   `common.relation-types` namespace.
 */
export function resolveRelationLabel(
  type: RelationTypeDB,
  tRelation: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (type.label) return type.label;
  return tRelation(type.id, { defaultValue: type.description ?? type.id });
}
