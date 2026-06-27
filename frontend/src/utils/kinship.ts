import { type TFunction } from "i18next";
import { type Gender } from "@/types/member";
import { type KinshipRelation } from "@/utils/graphUtils";

/**
 * Cutoff for "numeric great" rendering.
 *
 * For greats 0–2 we use explicit, fully-translated keys:
 *   0 → grand…          ("grandparent")
 *   1 → great-grand…    ("great-grandparent")
 *   2 → great-great-grand… ("great-great-grandparent")
 *
 * For greats >= 3 we fall back to a single parametrised key with {{count}}
 * where count = greats (the number of literal "great" prefixes), so
 * greats=3 → "3×-great-grandfather" (= great-great-great-grandfather).
 */
const NAMED_GREATS_MAX = 2;

/** Gender suffix used in i18n key names: "m" | "f" | "n" (neutral). */
function genderSuffix(gender: Gender): "m" | "f" | "n" {
  if (gender === "m") return "m";
  if (gender === "f") return "f";
  return "n";
}

/** Ordinal word for cousin degree 1–3; numeric string fallback beyond that. */
function degreeOrdinal(degree: number, t: TFunction): string {
  const key = `tree-view.connection.kinship.cousin-degree-${degree}`;
  // i18next returns the key itself when it's not found — detect that and fall back.
  const translated = t(key);
  if (translated !== key) return translated;
  return String(degree);
}

/** "once" / "twice" / "N times" removal label (omitted when removal === 0). */
function removalLabel(removal: number, t: TFunction): string {
  if (removal === 0) return "";
  const key = `tree-view.connection.kinship.removed-${removal}`;
  const translated = t(key);
  if (translated !== key) return translated;
  // Fallback: numeric with generic "times removed"
  return t("tree-view.connection.kinship.removed-n", { count: removal });
}

/**
 * Returns a localised kinship noun for `relation` as seen from a person with
 * `gender`, or `null` for `self` / `none`. The caller places the noun on the
 * connection-relation card's direction arrows.
 */
export function formatKinship(
  relation: KinshipRelation,
  gender: Gender,
  t: TFunction,
): string | null {
  const g = genderSuffix(gender);
  const ns = "tree-view.connection.kinship";

  switch (relation.kind) {
    case "self":
    case "none":
      return null;

    case "parent":
      return t(`${ns}.parent-${g}`);

    case "child":
      return t(`${ns}.child-${g}`);

    case "sibling":
      return t(`${ns}.sibling-${g}`);

    case "half-sibling":
      return t(`${ns}.half-sibling-${g}`);

    case "grandparent": {
      const { greats } = relation;
      if (greats <= NAMED_GREATS_MAX) {
        return t(`${ns}.grandparent-${greats}-${g}`);
      }
      return t(`${ns}.grandparent-n-${g}`, { count: greats });
    }

    case "grandchild": {
      const { greats } = relation;
      if (greats <= NAMED_GREATS_MAX) {
        return t(`${ns}.grandchild-${greats}-${g}`);
      }
      return t(`${ns}.grandchild-n-${g}`, { count: greats });
    }

    case "pibling": {
      const { greats } = relation;
      if (greats <= NAMED_GREATS_MAX) {
        return t(`${ns}.pibling-${greats}-${g}`);
      }
      return t(`${ns}.pibling-n-${g}`, { count: greats });
    }

    case "nibling": {
      const { greats } = relation;
      if (greats <= NAMED_GREATS_MAX) {
        return t(`${ns}.nibling-${greats}-${g}`);
      }
      return t(`${ns}.nibling-n-${g}`, { count: greats });
    }

    case "cousin": {
      const { degree, removal } = relation;
      const degreeWord = degreeOrdinal(degree, t);
      if (removal === 0) {
        return t(`${ns}.cousin`, { degree: degreeWord });
      }
      const removalWord = removalLabel(removal, t);
      return t(`${ns}.cousin-removed`, {
        degree: degreeWord,
        removal: removalWord,
      });
    }

    // --- Tier 2: partner-derived, in-law, and step relations ---

    case "partner": {
      const rt = relation.relationType;
      if (rt === "married") return t(`${ns}.partner-married-${g}`);
      if (rt === "divorced") return t(`${ns}.partner-divorced-${g}`);
      // "partner" and any other couple type
      return t(`${ns}.partner-partner-${g}`);
    }

    case "parent-in-law":
      return t(`${ns}.parent-in-law-${g}`);

    case "child-in-law":
      return t(`${ns}.child-in-law-${g}`);

    case "sibling-in-law":
      return t(`${ns}.sibling-in-law-${g}`);

    case "step-parent":
      return t(`${ns}.step-parent-${g}`);

    case "step-child":
      return t(`${ns}.step-child-${g}`);

    case "step-sibling":
      return t(`${ns}.step-sibling-${g}`);

    // --- Tier 3: graceful fallback ---
    case "relative":
      // Gender-neutral — "relative" reads the same regardless of gender.
      return relation.distant
        ? t(`${ns}.distant-relative`)
        : t(`${ns}.relative`);
  }
}
