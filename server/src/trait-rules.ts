import type { GameState, CardDef, Trait } from "@bsg/shared";

// ============================================================
// BSG CCG — Trait Rule Utilities
//
// Open/Closed architecture: all trait checks route through
// unitHasTrait(). To add a new trait source (e.g. equipment,
// missions, auras), extend the check list here — zero changes
// needed at the 60+ call sites.
//
// Duration scopes (per rulebook "Effects" section):
//   Phase-scoped: temporaryTraitGrants / temporaryTraitRemovals
//     "An effect lasts until the end of the current phase
//      unless otherwise specified."
//   Turn-scoped:  turnTraitGrants / turnTraitRemovals
//     For cards that explicitly say "until end of turn."
// ============================================================

/**
 * Central trait check for units on the board.
 * Checks (in priority order):
 *   1. Removals (phase-scoped + turn-scoped) — override everything
 *   2. Static traits from card definition
 *   3. Grants (phase-scoped + turn-scoped)
 */
export function unitHasTrait(
  state: GameState,
  instanceId: string,
  def: CardDef | null | undefined,
  trait: Trait,
): boolean {
  // 1. Removals override everything (both scopes)
  for (const player of state.players) {
    if (player.temporaryTraitRemovals?.[instanceId]?.includes(trait)) return false;
    if (player.turnTraitRemovals?.[instanceId]?.includes(trait)) return false;
  }

  // 2. Static traits from card definition
  if (def?.traits?.includes(trait)) return true;

  // 3. Temporary grants (both scopes)
  for (const player of state.players) {
    if (player.temporaryTraitGrants?.[instanceId]?.includes(trait)) return true;
    if (player.turnTraitGrants?.[instanceId]?.includes(trait)) return true;
  }

  return false;
}
