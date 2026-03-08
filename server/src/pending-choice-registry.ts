/**
 * Pending Choice Registry — OCP pattern for player choice resolution.
 *
 * Replaces the parallel switch statements in game-engine.ts (resolvePendingChoice,
 * getPendingChoiceActions) and ai-player.ts (decidePendingChoice).
 *
 * Each handler provides all three methods, co-located with the ability that
 * creates the choice.
 */
import type {
  GameState,
  PlayerState,
  ValidAction,
  CardInstance,
  UnitStack,
  CardDef,
  BaseCardDef,
  LogItem,
  PendingChoiceType,
} from "@bsg/shared";

// ============================================================
// Helpers interface — injected by game-engine.ts via DI
// ============================================================

export interface PendingChoiceHelpers {
  getCardDef(defId: string): CardDef;
  cardName(def: CardDef): string;
  defeatUnit(
    player: PlayerState,
    instanceId: string,
    log: LogItem[],
    state: GameState,
    playerIndex: number,
  ): void;
  commitUnit(player: PlayerState, instanceId: string, log?: LogItem[]): void;
  readyUnit(player: PlayerState, instanceId: string, log?: LogItem[]): boolean;
  drawCards(
    player: PlayerState,
    count: number,
    log: LogItem[],
    label: string,
    state?: GameState,
    playerIndex?: number,
  ): void;
  applyPowerBuff(state: GameState, instanceId: string, amount: number, log: LogItem[]): void;
  applyInfluenceLoss(
    state: GameState,
    playerIndex: number,
    amount: number,
    log: LogItem[],
    bases: Record<string, BaseCardDef>,
  ): void;
  resumeChallenge(state: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void;
  findUnitInZone(zone: UnitStack[], instanceId: string): { stack: UnitStack; index: number } | null;
  findUnitInAnyZone(
    player: PlayerState,
    instanceId: string,
  ): { stack: UnitStack; zone: "alert" | "reserve"; index: number } | null;
  bases: Record<string, BaseCardDef>;
}

// ============================================================
// Handler interface
// ============================================================

export type PendingChoice = NonNullable<GameState["pendingChoice"]>;

export interface PendingChoiceHandler {
  /** Return the list of ValidActions to present to the player. */
  getActions(choice: PendingChoice, state: GameState): ValidAction[];

  /**
   * Apply the player's selection.
   * May set state.pendingChoice to chain to a new choice.
   */
  resolve(
    choice: PendingChoice,
    choiceIndex: number,
    state: GameState,
    player: PlayerState,
    playerIndex: number,
    log: LogItem[],
  ): void;

  /**
   * Return the choiceIndex the AI should pick.
   * choiceActions is the pre-filtered list of makeChoice actions.
   */
  aiDecide(
    choice: PendingChoice,
    choiceActions: ValidAction[],
    state: GameState,
    playerIndex: number,
  ): number;
}

// ============================================================
// Registry + DI
// ============================================================

const registry = new Map<PendingChoiceType, PendingChoiceHandler>();

let h: PendingChoiceHelpers;

export function setPendingChoiceHelpers(helpers: PendingChoiceHelpers): void {
  h = helpers;
}

export function getHelpers(): PendingChoiceHelpers {
  return h;
}

export function registerPendingChoice(
  type: PendingChoiceType,
  handler: PendingChoiceHandler,
): void {
  registry.set(type, handler);
}

// ============================================================
// Dispatchers — called by game-engine.ts and ai-player.ts
// Return null when no handler registered (signals fallback to legacy switch)
// ============================================================

export function dispatchGetPendingChoiceActions(state: GameState): ValidAction[] | null {
  const choice = state.pendingChoice;
  if (!choice) return null;
  const handler = registry.get(choice.type);
  if (!handler) return null;
  return handler.getActions(choice, state);
}

export function dispatchResolvePendingChoice(
  state: GameState,
  choiceIndex: number,
  player: PlayerState,
  playerIndex: number,
  log: LogItem[],
): boolean {
  const choice = state.pendingChoice;
  if (!choice) return false;
  const handler = registry.get(choice.type);
  if (!handler) return false;
  handler.resolve(choice, choiceIndex, state, player, playerIndex, log);
  return true;
}

export function dispatchAIDecidePendingChoice(
  state: GameState,
  choiceActions: ValidAction[],
  playerIndex: number,
): number | null {
  const choice = state.pendingChoice;
  if (!choice) return null;
  const handler = registry.get(choice.type);
  if (!handler) return null;
  return handler.aiDecide(choice, choiceActions, state, playerIndex);
}
