import type { CardDef, Keyword } from "@bsg/shared";

// ============================================================
// BSG CCG — Keyword Rule Registry
//
// Open/Closed architecture: the game engine calls generic
// dispatchers at fixed hook points. Adding a new keyword means
// adding a registerKeyword() call here — zero engine changes.
// ============================================================

// --- Rule Definition ---

export interface KeywordRule {
  keyword: Keyword;

  /** Can a unit with this keyword initiate a challenge? (default: true) */
  canChallenge?: boolean;

  /** Can a unit with this keyword defend?
   *  false       → hard block (can never defend)
   *  "any-type"  → can defend against any challenger type (cross-type)
   *  undefined   → use default type-matching */
  canDefend?: false | "any-type";

  /** Who selects the defender when this keyword is on the challenger?
   *  "challenger" → attacking player picks defender (Sniper)
   *  undefined    → defending player picks (default) */
  defenderSelector?: "challenger";

  /** Modify undefended challenge resolution when keyword is on challenger.
   *  "gain-influence" → challenger gains influence instead of opponent losing
   *  undefined        → normal (opponent loses influence) */
  undefendedEffect?: "gain-influence";

  /** Where does a resolved mission with this keyword go?
   *  "reserve"   → stays in play in reserve area (Persistent)
   *  undefined   → discard pile (default) */
  missionDestination?: "reserve";
}

// --- Registry ---

const rules = new Map<Keyword, KeywordRule>();

function registerKeyword(rule: KeywordRule): void {
  rules.set(rule.keyword, rule);
}

// --- Keyword Registrations ---

registerKeyword({
  keyword: "Vision",
  canChallenge: false,
  canDefend: false,
});

registerKeyword({
  keyword: "Scramble",
  canDefend: "any-type",
});

registerKeyword({
  keyword: "Sniper",
  defenderSelector: "challenger",
});

registerKeyword({
  keyword: "Manipulate",
  undefendedEffect: "gain-influence",
});

registerKeyword({
  keyword: "Persistent",
  missionDestination: "reserve",
});

registerKeyword({
  keyword: "Vulnerable",
  // Any unit type can defend against a Vulnerable challenger
  // Handled in canUnitDefend by checking challenger keywords
});

registerKeyword({
  keyword: "Strafe",
  // Unit can challenge as personnel or ship (type choice before defender selection)
  // Handled in challenge initiation
});

registerKeyword({
  keyword: "Link",
  // Mission attaches to a unit when resolved — identification only, no standard KeywordRule behavior
  // Handled in mission-abilities.ts
});

// --- Dispatchers (called by game engine at hook points) ---

/** Check if a unit can initiate a challenge. */
export function canUnitChallenge(def: CardDef): boolean {
  for (const kw of def.keywords ?? []) {
    const rule = rules.get(kw);
    if (rule?.canChallenge === false) return false;
  }
  return true;
}

/** Check if a unit can defend against a specific challenger.
 *  Aggregation: any hard block → false; any "any-type" → true; else default type-match. */
export function canUnitDefend(defenderDef: CardDef, challengerDef: CardDef): boolean {
  let explicitAllow = false;
  for (const kw of defenderDef.keywords ?? []) {
    const rule = rules.get(kw);
    if (rule?.canDefend === false) return false;
    if (rule?.canDefend === "any-type") explicitAllow = true;
  }
  // Vulnerable on the challenger: any unit type can defend against it
  for (const kw of challengerDef.keywords ?? []) {
    if (kw === "Vulnerable") {
      explicitAllow = true;
      break;
    }
  }
  return explicitAllow || defenderDef.type === challengerDef.type;
}

/** Determine who selects the defender for a challenge. */
export function getDefenderSelector(challengerDef: CardDef): "challenger" | "defender" {
  for (const kw of challengerDef.keywords ?? []) {
    const rule = rules.get(kw);
    if (rule?.defenderSelector) return rule.defenderSelector;
  }
  return "defender";
}

/** Get the undefended challenge effect based on challenger keywords. */
export function getUndefendedEffect(challengerDef: CardDef): "normal" | "gain-influence" {
  for (const kw of challengerDef.keywords ?? []) {
    const rule = rules.get(kw);
    if (rule?.undefendedEffect) return rule.undefendedEffect;
  }
  return "normal";
}

/** Get where a resolved mission should go. */
export function getMissionDestination(missionDef: CardDef): "discard" | "reserve" {
  for (const kw of missionDef.keywords ?? []) {
    const rule = rules.get(kw);
    if (rule?.missionDestination) return rule.missionDestination;
  }
  return "discard";
}
