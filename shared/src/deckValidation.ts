import type { CardRegistry } from "./index.js";

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

/** Get the full card name used for the 4-copy uniqueness rule */
function getCardName(card: { title?: string; subtitle?: string; id: string }): string {
  if (card.title && card.subtitle) return `${card.title}, ${card.subtitle}`;
  return card.subtitle ?? card.title ?? card.id;
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
    const name = getCardName(def);
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
