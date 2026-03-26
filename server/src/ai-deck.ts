import type { CardRegistry, CardDef, DeckSubmission, ResourceType } from "@bsg/shared";
import { cardName } from "@bsg/shared";
import { shuffle } from "./utils.js";

// ============================================================
// BSG CCG — AI Deck Builder
// Generates a valid 60-card deck for the AI opponent.
// ============================================================

/** Pick a random element from an array */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random integer in [min, max] inclusive */
function randRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const ALL_RESOURCES: ResourceType[] = ["persuasion", "logistics", "security"];

/**
 * Build a valid 60-card AI deck.
 * Strategy:
 *   1. Pick a random base (determines primary resource)
 *   2. ~50% chance of a secondary resource for a dual-resource deck
 *   3. Fill 4 pools: personnel (19-21), ships (19-21), events (8-11), missions (8-11)
 *   4. Max 4 copies of any card name
 */
export function buildAIDeck(registry: CardRegistry): DeckSubmission {
  const baseIds = Object.keys(registry.bases);
  const baseId = pickRandom(baseIds);
  const base = registry.bases[baseId];
  const primaryResource = base.resource;

  // ~50% chance of dual-resource deck
  const secondaryResource: ResourceType | null =
    Math.random() < 0.5 ? pickRandom(ALL_RESOURCES.filter((r) => r !== primaryResource)) : null;

  const allCards = Object.values(registry.cards);

  // Separate cards into 4 pools
  const personnel = allCards.filter((c) => c.type === "personnel");
  const ships = allCards.filter((c) => c.type === "ship");
  const events = allCards.filter((c) => c.type === "event");
  const missions = allCards.filter((c) => c.type === "mission");

  // Score and sort each pool
  const scoreAndSort = (cards: CardDef[]) => {
    const scored = cards.map((card) => ({
      card,
      score: scoreCard(card, primaryResource, secondaryResource),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  };

  const scoredPersonnel = scoreAndSort(personnel);
  const scoredShips = scoreAndSort(ships);
  const scoredEvents = scoreAndSort(events);
  const scoredMissions = scoreAndSort(missions);

  const deckCardIds: string[] = [];
  const nameCounts = new Map<string, number>();
  const TARGET_SIZE = 60;

  // Pick target counts within ranges
  const targetPersonnel = randRange(19, 21);
  const targetShips = randRange(19, 21);
  const targetEvents = randRange(8, 11);
  const targetMissions = randRange(8, 11);

  addCards(scoredPersonnel, deckCardIds, nameCounts, targetPersonnel);
  addCards(scoredShips, deckCardIds, nameCounts, targetShips);
  addCards(scoredEvents, deckCardIds, nameCounts, targetEvents);
  addCards(scoredMissions, deckCardIds, nameCounts, targetMissions);

  // If under 60, fill from any remaining cards
  if (deckCardIds.length < TARGET_SIZE) {
    const allScored = allCards.map((card) => ({
      card,
      score: scoreCard(card, primaryResource, secondaryResource),
    }));
    allScored.sort((a, b) => b.score - a.score);
    addCards(allScored, deckCardIds, nameCounts, TARGET_SIZE - deckCardIds.length);
  }

  return { baseId, deckCardIds };
}

function scoreCard(
  card: CardDef,
  primaryResource: ResourceType,
  secondaryResource: ResourceType | null,
): number {
  let score = 0;

  // Strongly prefer cards that produce the primary resource
  if (card.resource === primaryResource) score += 10;
  else if (secondaryResource && card.resource === secondaryResource) score += 6;

  // Prefer cards with costs matching our resources (easier to pay)
  if (card.cost) {
    const costEntries = Object.entries(card.cost) as [ResourceType, number][];
    const allMatchPrimary = costEntries.every(([res]) => res === primaryResource);
    const allMatchEither = costEntries.every(
      ([res]) => res === primaryResource || res === secondaryResource,
    );
    if (allMatchPrimary) score += 5;
    else if (secondaryResource && allMatchEither) score += 3;
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
    const name = cardName(card);
    const current = nameCounts.get(name) ?? 0;
    if (current >= 4) continue;
    const toAdd = Math.min(4 - current, count - added);
    for (let i = 0; i < toAdd; i++) {
      deckCardIds.push(card.id);
    }
    nameCounts.set(name, current + toAdd);
    added += toAdd;
  }
}
