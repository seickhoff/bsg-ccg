import type { UnitStack, PlayerState, GameState } from "@bsg/shared";

export function findUnitInZone(
  zone: UnitStack[],
  instanceId: string,
): { stack: UnitStack; index: number } | null {
  for (let i = 0; i < zone.length; i++) {
    if (zone[i].cards[0]?.instanceId === instanceId) {
      return { stack: zone[i], index: i };
    }
  }
  return null;
}

export function findUnitInAnyZone(
  player: PlayerState,
  instanceId: string,
): { stack: UnitStack; zone: "alert" | "reserve"; index: number } | null {
  const alertResult = findUnitInZone(player.zones.alert, instanceId);
  if (alertResult) return { ...alertResult, zone: "alert" };
  const reserveResult = findUnitInZone(player.zones.reserve, instanceId);
  if (reserveResult) return { ...reserveResult, zone: "reserve" };
  return null;
}

export function findUnitOwner(
  state: GameState,
  instanceId: string,
): {
  player: PlayerState;
  playerIndex: number;
  stack: UnitStack;
  zone: "alert" | "reserve";
  index: number;
} | null {
  for (let pi = 0; pi < state.players.length; pi++) {
    const result = findUnitInAnyZone(state.players[pi], instanceId);
    if (result) return { player: state.players[pi], playerIndex: pi, ...result };
  }
  return null;
}
