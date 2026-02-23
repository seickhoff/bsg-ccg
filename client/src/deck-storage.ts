// ============================================================
// BSG CCG — Deck Storage (localStorage persistence)
// ============================================================

export interface SavedDeck {
  baseId: string;
  deckCardIds: string[];
}

const STORAGE_KEY = "bsg-ccg-deck";

export function saveDeck(deck: SavedDeck): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
}

export function loadDeck(): SavedDeck | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.baseId === "string" && Array.isArray(parsed.deckCardIds)) {
      return parsed as SavedDeck;
    }
    return null;
  } catch {
    return null;
  }
}
