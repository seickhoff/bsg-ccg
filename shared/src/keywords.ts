// ============================================================
// BSG CCG — Keyword System
// Type-safe keyword extraction and helpers for the card database.
// ============================================================

export type Keyword =
  | "Vision"
  | "Scramble"
  | "Sniper"
  | "Manipulate"
  | "Expedite"
  | "Persistent"
  | "Vulnerable"
  | "Strafe"
  | "Link";

/** Patterns that match keywords a card ITSELF has (at start of text or after newline).
 *  Excludes "Target gains Keyword" patterns (those grant keywords to other cards). */
const KEYWORD_PATTERNS: { keyword: Keyword; pattern: RegExp }[] = [
  { keyword: "Vision", pattern: /(?:^|\n)\s*Vision\b/ },
  { keyword: "Scramble", pattern: /(?:^|\n)\s*Scramble\b/ },
  { keyword: "Sniper", pattern: /(?:^|\n)\s*Sniper\b/ },
  { keyword: "Manipulate", pattern: /(?:^|\n)\s*Manipulate\b/ },
  { keyword: "Expedite", pattern: /(?:^|\n)\s*Expedite\b/ },
  { keyword: "Persistent", pattern: /(?:^|\n)\s*Persistent\b/ },
  { keyword: "Vulnerable", pattern: /(?:^|\n)\s*Vulnerable\b/ },
  { keyword: "Link", pattern: /(?:^|\n)\s*Link\b/ },
];

/** Extract keywords that a card itself possesses from its abilityText. */
export function extractKeywords(abilityText: string): Keyword[] {
  const found: Keyword[] = [];
  for (const { keyword, pattern } of KEYWORD_PATTERNS) {
    if (pattern.test(abilityText)) {
      found.push(keyword);
    }
  }
  return found;
}

/** Check if a CardDef has a specific keyword. */
export function hasKeyword(def: { keywords?: Keyword[] }, kw: Keyword): boolean {
  return def.keywords?.includes(kw) ?? false;
}
