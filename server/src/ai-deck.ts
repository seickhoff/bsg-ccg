import type { CardRegistry, CardDef, DeckSubmission, ResourceType } from "@bsg/shared";

// ============================================================
// BSG CCG — AI Deck Builder
// Generates a valid 60-card deck for the AI opponent.
// ============================================================

/** Pick a random element from an array */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Shuffle an array in-place (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a valid 60-card AI deck.
 * Strategy:
 *   1. Pick a random base
 *   2. Prioritize units (personnel/ships) that produce the base's resource type (~32 cards)
 *   3. Fill remaining slots with events and missions (~28 cards)
 *   4. Max 4 copies of any card name
 */
export function buildAIDeck(registry: CardRegistry): DeckSubmission {
  const baseIds = Object.keys(registry.bases);
  const baseId = pickRandom(baseIds);
  const base = registry.bases[baseId];
  const baseResource = base.resource;

  const allCards = Object.values(registry.cards);

  // Separate cards by type
  const units = allCards.filter((c) => c.type === "personnel" || c.type === "ship");
  const nonUnits = allCards.filter((c) => c.type === "event" || c.type === "mission");

  // Score units: prefer those matching the base's resource
  const scoredUnits = units.map((card) => ({
    card,
    score: scoreCard(card, baseResource),
  }));
  scoredUnits.sort((a, b) => b.score - a.score);

  // Score non-units: prefer cheaper events, and missions
  const scoredNonUnits = nonUnits.map((card) => ({
    card,
    score: scoreCard(card, baseResource),
  }));
  scoredNonUnits.sort((a, b) => b.score - a.score);

  const deckCardIds: string[] = [];
  const nameCounts = new Map<string, number>();
  const TARGET_SIZE = 60;
  const TARGET_UNITS = 34;

  // Add units first
  addCards(scoredUnits, deckCardIds, nameCounts, TARGET_UNITS);

  // Fill rest with non-units
  const remaining = TARGET_SIZE - deckCardIds.length;
  addCards(scoredNonUnits, deckCardIds, nameCounts, remaining);

  // If still under 60 (unlikely), add any remaining cards
  if (deckCardIds.length < TARGET_SIZE) {
    const allScored = shuffle(allCards.map((card) => ({ card, score: 0 })));
    addCards(allScored, deckCardIds, nameCounts, TARGET_SIZE - deckCardIds.length);
  }

  return { baseId, deckCardIds };
}

function getCardName(card: CardDef): string {
  if (card.title && card.subtitle) return `${card.title}, ${card.subtitle}`;
  return card.subtitle ?? card.title ?? card.id;
}

function scoreCard(card: CardDef, baseResource: ResourceType): number {
  let score = 0;

  // Strongly prefer cards that produce the base's resource
  if (card.resource === baseResource) score += 10;

  // Prefer cards with costs in the base's resource (easier to pay)
  if (card.cost) {
    const costEntries = Object.entries(card.cost) as [ResourceType, number][];
    const matchingCost = costEntries.every(([res]) => res === baseResource);
    if (matchingCost) score += 5;
  }

  // Prefer higher power units
  if (card.power) score += card.power;

  // Prefer lower total cost (more playable)
  if (card.cost) {
    const totalCost = Object.values(card.cost).reduce((a, b) => a + b, 0);
    score -= totalCost;
  }

  // Slight preference for higher mystic values
  if (card.mysticValue) score += card.mysticValue * 0.5;

  // Small random factor for variety
  score += Math.random() * 2;

  return score;
}

function addCards(
  scored: { card: CardDef; score: number }[],
  deckCardIds: string[],
  nameCounts: Map<string, number>,
  count: number,
): void {
  let added = 0;
  for (const { card } of scored) {
    if (added >= count) break;
    const name = getCardName(card);
    const current = nameCounts.get(name) ?? 0;
    // Add up to 4 copies
    const toAdd = Math.min(4 - current, count - added);
    for (let i = 0; i < toAdd; i++) {
      deckCardIds.push(card.id);
    }
    nameCounts.set(name, current + toAdd);
    added += toAdd;
  }
}
