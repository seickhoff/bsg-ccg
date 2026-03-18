import type { CardRegistry } from "./index.js";
import { cardName } from "./index.js";

// ============================================================
// BSG CCG — Deck Validation
// Shared between client and server to ensure consistent rules.
// ============================================================

export interface DeckSubmission {
  baseId: string;
  deckCardIds: string[]; // may contain duplicates (e.g. 4x of same card)
}

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDeck(
  submission: DeckSubmission,
  registry: CardRegistry,
): DeckValidationResult {
  const errors: string[] = [];

  // Base must exist
  if (!registry.bases[submission.baseId]) {
    errors.push(`Unknown base: ${submission.baseId}`);
    return { valid: false, errors };
  }

  // Minimum 60 cards
  if (submission.deckCardIds.length < 60) {
    errors.push(`Deck must have at least 60 cards (has ${submission.deckCardIds.length})`);
  }

  // All card IDs must exist and count copies by name
  const nameCounts = new Map<string, number>();
  for (const cardId of submission.deckCardIds) {
    const def = registry.cards[cardId];
    if (!def) {
      errors.push(`Unknown card: ${cardId}`);
      continue;
    }
    const name = cardName(def);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  // Max 4 copies per card name
  for (const [name, count] of nameCounts) {
    if (count > 4) {
      errors.push(`Too many copies of "${name}" (${count}, max 4)`);
    }
  }

  return { valid: errors.length === 0, errors };
}
