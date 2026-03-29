import type {
  GameState,
  BaseCardDef,
  CardDef,
  ValidAction,
  UnitStack,
  CardInstance,
  LogItem,
  Trait,
} from "@bsg/shared";
import { cardName } from "@bsg/shared";
import { registerPendingChoice } from "./pending-choice-registry.js";
import { unitHasTrait } from "./trait-rules.js";
import { findUnitInAnyZone } from "./zone-helpers.js";

// ============================================================
// BSG CCG — Base Ability Registry
//
// Open/Closed architecture matching keyword-rules.ts:
// Each base registers a handler; the engine calls dispatchers
// at hook points. New bases = new registrations, zero engine changes.
// ============================================================

// --- Handler Interface ---

export interface BaseAbilityHandler {
  /** Contexts where this ability appears as a voluntary action */
  usableIn: ("execution" | "challenge" | "cylon-challenge")[];

  /** For triggered abilities (engine invokes at hook points) */
  trigger?: "onChallenged" | "onInfluenceLoss" | "onCylonReveal" | "onMissionResolve";

  /**
   * Get valid target instanceIds for this ability.
   * Return null if no target needed.
   * Return empty array if targets needed but none available.
   */
  getTargets(
    state: GameState,
    playerIndex: number,
    bases: Record<string, BaseCardDef>,
  ): string[] | null;

  /**
   * Apply the ability effect.
   * The base is already exhausted by the engine before calling this.
   */
  resolve(
    state: GameState,
    playerIndex: number,
    targetInstanceId: string | undefined,
    log: LogItem[],
    bases: Record<string, BaseCardDef>,
  ): void;

  // --- DIP hooks (Phase 3) ---

  /** Base counts as a Civilian unit for mission requirements */
  countsAsCivilian?: boolean;

  /** Base can auto-exhaust to reduce influence loss (return reduced amount) */
  influenceLossReduction?: number;

  /**
   * Hook called when Cylon threats are revealed, before red text fires.
   * Return true if the ability set up a pendingChoice (pauses cylon phase).
   */
  onCylonReveal?(
    state: GameState,
    playerIndex: number,
    log: LogItem[],
    bases: Record<string, BaseCardDef>,
  ): boolean;
}

// --- Registry ---

const registry = new Map<string, BaseAbilityHandler>();

function registerBaseAbility(abilityId: string, handler: BaseAbilityHandler): void {
  registry.set(abilityId, handler);
}

export function getBaseAbilityHandler(abilityId: string): BaseAbilityHandler | undefined {
  return registry.get(abilityId);
}

// --- Card Def Helper (duplicated from engine to avoid circular imports) ---

let cardRegistryRef: Record<string, CardDef> = {};

export function setBaseAbilityCardRegistry(cards: Record<string, CardDef>): void {
  cardRegistryRef = cards;
}

type InfluenceLossFn = (
  state: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
) => void;

let applyInfluenceLossFn: InfluenceLossFn | null = null;

export function setBaseAbilityInfluenceLoss(fn: InfluenceLossFn): void {
  applyInfluenceLossFn = fn;
}

function getCardDef(defId: string): CardDef | undefined {
  return cardRegistryRef[defId];
}

// --- Utility: find units in zones ---

function findUnitsInZone(
  zone: UnitStack[],
  filter: (def: CardDef, instanceId: string) => boolean,
): { instanceId: string; def: CardDef }[] {
  const results: { instanceId: string; def: CardDef }[] = [];
  for (const stack of zone) {
    const topCard = stack.cards[0];
    if (topCard && topCard.faceUp && !stack.exhausted) {
      const def = getCardDef(topCard.defId);
      if (def && filter(def, topCard.instanceId)) {
        results.push({ instanceId: topCard.instanceId, def });
      }
    }
  }
  return results;
}

// ============================================================
// Base Ability Registrations
// ============================================================

// --- Colonial One: target player +1 influence ---
registerBaseAbility("colonial-one", {
  usableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    const targets: string[] = [];
    for (let i = 0; i < state.players.length; i++) {
      targets.push(`player-${i}`);
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId || !targetId.startsWith("player-")) return;
    const targetPlayerIndex = parseInt(targetId.split("-")[1], 10);
    if (isNaN(targetPlayerIndex) || !state.players[targetPlayerIndex]) return;
    if (state.preventInfluenceGain) {
      log.push(`${state.preventInfluenceGain}: influence gain prevented.`);
      return;
    }
    state.players[targetPlayerIndex].influence += 1;
    log.push(
      `Colonial One: ${state.playerNames[targetPlayerIndex as 0 | 1]} gains 1 influence. (Now ${state.players[targetPlayerIndex].influence})`,
    );
  },
});

// --- Galactica: target player -1 influence ---
registerBaseAbility("galactica", {
  usableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    const targets: string[] = [];
    for (let i = 0; i < state.players.length; i++) {
      targets.push(`player-${i}`);
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId || !targetId.startsWith("player-")) return;
    const targetPlayerIndex = parseInt(targetId.split("-")[1], 10);
    if (isNaN(targetPlayerIndex) || !state.players[targetPlayerIndex]) return;
    applyInfluenceLossFn!(state, targetPlayerIndex, 1, log);
  },
});

// --- Celestra: deck manipulation ---
registerBaseAbility("celestra", {
  usableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets: () => null,
  resolve(state, playerIndex, _target, log) {
    const player = state.players[playerIndex];
    if (player.deck.length < 2) {
      log.push("Celestra: Not enough cards in deck to use ability.");
      return;
    }
    // Pop top 2 cards from deck into pendingChoice
    const card1 = player.deck.shift()!;
    const card2 = player.deck.shift()!;
    state.pendingChoice = {
      type: "celestra",
      playerIndex,
      cards: [card1, card2],
      prompt: "Celestra — choose which card to put on top of your deck",
    };
    const def1 = getCardDef(card1.defId);
    const def2 = getCardDef(card2.defId);
    log.push(
      `Celestra: ${state.playerNames[playerIndex as 0 | 1]} looks at the top two cards of their deck.`,
    );
  },
});

// --- Cylon Base Star: ready target Cylon unit ---
registerBaseAbility("cylon-base-star", {
  usableIn: ["execution"],
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    // Target: face-up Cylon units in own reserve
    return findUnitsInZone(player.zones.reserve, (def, instanceId) => {
      return (
        (def.type === "personnel" || def.type === "ship") &&
        unitHasTrait(state, instanceId, def, "Cylon" as Trait)
      );
    }).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetInstanceId, log) {
    if (!targetInstanceId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetInstanceId);
    if (found && found.zone === "reserve") {
      player.zones.reserve.splice(found.index, 1);
      player.zones.alert.push(found.stack);
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`Cylon Base Star: Readied ${def ? cardName(def) : "Cylon unit"}.`);
    }
  },
});

// --- Ragnar Anchorage: extra action + resource override ---
registerBaseAbility("ragnar-anchorage", {
  usableIn: ["execution"],
  getTargets: () => null,
  resolve(state, playerIndex, _target, log) {
    const player = state.players[playerIndex];
    player.ragnarExtraAction = true;
    player.ragnarResourceOverride = true;
    log.push(
      "Ragnar Anchorage: Take an extra action. Next resource spend: logistics ≥2 generates 3 of any type.",
    );
  },
});

// --- Battlestar Galactica: +2 to challenging unit ---
registerBaseAbility("battlestar-galactica", {
  usableIn: ["challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge) return [];
    if (state.challenge.challengerPlayerIndex !== playerIndex) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, _playerIndex, targetInstanceId, log) {
    if (!state.challenge || !targetInstanceId) return;
    if (targetInstanceId === state.challenge.challengerInstanceId) {
      state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 2;
      log.push("Battlestar Galactica: Challenger gets +2 power.");
    }
  },
});

// --- Assault Base Star: +2 to Cylon unit ---
// Card text: "Exhaust: Target Cylon unit gets +2 power."
// No challenge restriction — usable in execution phase or during challenges.
registerBaseAbility("assault-base-star", {
  usableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    const targets: string[] = [];

    if (state.challenge) {
      // During a challenge: target Cylon units involved in the challenge
      const challengerDef = findChallengeUnitDef(state, state.challenge.challengerInstanceId);
      if (challengerDef?.traits?.includes("Cylon")) {
        targets.push(state.challenge.challengerInstanceId);
      }
      if (state.challenge.defenderInstanceId && !state.challenge.isCylonChallenge) {
        const defenderDef = findChallengeUnitDef(state, state.challenge.defenderInstanceId);
        if (defenderDef?.traits?.includes("Cylon")) {
          targets.push(state.challenge.defenderInstanceId);
        }
      }
    } else {
      // During execution: target any face-up Cylon unit the player controls
      const player = state.players[playerIndex];
      for (const unit of findUnitsInZone(
        player.zones.alert,
        (def) =>
          (def.type === "personnel" || def.type === "ship") &&
          (def.traits?.includes("Cylon") ?? false),
      )) {
        targets.push(unit.instanceId);
      }
    }

    return targets;
  },
  resolve(state, playerIndex, targetInstanceId, log) {
    if (!targetInstanceId) return;

    if (state.challenge) {
      // During challenge: apply buff to challenge state
      if (targetInstanceId === state.challenge.challengerInstanceId) {
        state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 2;
        log.push("Assault Base Star: Cylon challenger gets +2 power.");
      } else if (targetInstanceId === state.challenge.defenderInstanceId) {
        state.challenge.defenderPowerBuff = (state.challenge.defenderPowerBuff ?? 0) + 2;
        log.push("Assault Base Star: Cylon defender gets +2 power.");
      }
    } else {
      // During execution: apply persistent power buff to unit stack
      const player = state.players[playerIndex];
      const found = findUnitInAnyZone(player, targetInstanceId);
      if (found) {
        found.stack.powerBuff = (found.stack.powerBuff ?? 0) + 2;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`Assault Base Star: ${def ? cardName(def) : "Cylon unit"} gets +2 power.`);
      }
    }
  },
});

// --- BS-75 Galactica: +3 to unit challenging Cylon threat ---
registerBaseAbility("bs75-galactica", {
  usableIn: ["cylon-challenge"],
  getTargets(state) {
    if (!state.challenge?.isCylonChallenge) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, _playerIndex, _targetInstanceId, log) {
    if (!state.challenge) return;
    state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 3;
    log.push("BS-75 Galactica: Cylon threat challenger gets +3 power.");
  },
});

// --- Delphi Union High School: +1 to any unit in challenge ---
registerBaseAbility("delphi-union", {
  usableIn: ["challenge", "cylon-challenge"],
  getTargets(state) {
    if (!state.challenge) return [];
    const targets = [state.challenge.challengerInstanceId];
    if (state.challenge.defenderInstanceId && !state.challenge.isCylonChallenge) {
      targets.push(state.challenge.defenderInstanceId);
    }
    return targets;
  },
  resolve(state, _playerIndex, targetInstanceId, log) {
    if (!state.challenge || !targetInstanceId) return;
    if (targetInstanceId === state.challenge.challengerInstanceId) {
      state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 1;
      log.push("Delphi Union High School: Challenger gets +1 power.");
    } else if (targetInstanceId === state.challenge.defenderInstanceId) {
      state.challenge.defenderPowerBuff = (state.challenge.defenderPowerBuff ?? 0) + 1;
      log.push("Delphi Union High School: Defender gets +1 power.");
    }
  },
});

// --- Agro Ship: triggered on challenged, ready personnel ---
registerBaseAbility("agro-ship", {
  usableIn: [],
  trigger: "onChallenged",
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    // Target: face-up personnel in own reserve
    return findUnitsInZone(player.zones.reserve, (def) => {
      return def.type === "personnel";
    }).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetInstanceId, log) {
    if (!targetInstanceId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetInstanceId);
    if (found && found.zone === "reserve") {
      player.zones.reserve.splice(found.index, 1);
      player.zones.alert.push(found.stack);
      if (state.challenge) {
        state.challenge.triggerReadiedInstanceId = targetInstanceId;
      }
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`Agro Ship: Readied ${def ? cardName(def) : "personnel"}.`);
    }
  },
});

// --- Flattop: triggered on challenged, ready ship ---
registerBaseAbility("flattop", {
  usableIn: [],
  trigger: "onChallenged",
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    // Target: face-up ships in own reserve
    return findUnitsInZone(player.zones.reserve, (def) => {
      return def.type === "ship";
    }).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetInstanceId, log) {
    if (!targetInstanceId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetInstanceId);
    if (found && found.zone === "reserve") {
      player.zones.reserve.splice(found.index, 1);
      player.zones.alert.push(found.stack);
      if (state.challenge) {
        state.challenge.triggerReadiedInstanceId = targetInstanceId;
      }
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`Flattop: Readied ${def ? cardName(def) : "ship"}.`);
    }
  },
});

// --- I.H.T. Colonial One: reduce influence loss by 2 ---
registerBaseAbility("iht-colonial-one", {
  usableIn: [],
  trigger: "onInfluenceLoss",
  influenceLossReduction: 2,
  getTargets: () => null,
  resolve() {
    // Handled by interceptInfluenceLoss dispatcher
  },
});

registerBaseAbility("blockading-base-star", {
  usableIn: [],
  trigger: "onCylonReveal",
  getTargets: () => null,
  resolve() {},
  onCylonReveal(state, playerIndex, log, bases) {
    // Find threats with red text
    const threatsWithText: CardInstance[] = [];
    for (const threat of state.cylonThreats) {
      const def = cardRegistryRef[threat.card.defId];
      if (def?.cylonThreatText) {
        threatsWithText.push(threat.card);
      }
    }
    if (threatsWithText.length === 0) return false;

    const baseDef = bases[state.players[playerIndex].baseDefId];
    log.push(`${baseDef.title}: Cylon threats revealed — choose whether to block threat text.`);
    state.pendingChoice = {
      type: "blockading-threat",
      playerIndex,
      cards: threatsWithText,
      context: { baseOwnerIndex: playerIndex },
      prompt: "Blockading Base Star — Exhaust to negate a threat's red text?",
    };
    state.cylonPhaseResumeNeeded = true;
    return true;
  },
});

registerBaseAbility("colonial-heavy-798", {
  usableIn: [],
  trigger: "onMissionResolve",
  countsAsCivilian: true,
  getTargets: () => null,
  resolve() {
    // Handled by mission resolve logic in engine
  },
});

// ============================================================
// Dispatchers (called by game engine)
// ============================================================

/** Get valid actions for a base ability in a given context. */
export function getBaseAbilityActions(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  bases: Record<string, BaseCardDef>,
  context: "execution" | "challenge" | "cylon-challenge",
): ValidAction[] {
  const handler = registry.get(abilityId);
  if (!handler) return [];
  if (!handler.usableIn.includes(context)) return [];

  const player = state.players[playerIndex];
  const baseDef = bases[player.baseDefId];
  const baseStack = player.zones.resourceStacks[0];
  if (!baseStack || baseStack.exhausted) return [];

  const targets = handler.getTargets(state, playerIndex, bases);

  // No target needed — single action
  if (targets === null) {
    return [
      {
        type: "playAbility",
        description: `${baseDef.title}: ${baseDef.abilityText}`,
        cardDefId: baseDef.id,
        selectableInstanceIds: [baseStack.topCard.instanceId],
      },
    ];
  }

  // Targets needed but none available
  if (targets.length === 0) return [];

  // Player targets — single action with player picker
  const playerTargets = targets.filter((t) => t.startsWith("player-"));
  if (playerTargets.length > 0 && playerTargets.length === targets.length) {
    const playerIndices = playerTargets.map((t) => parseInt(t.split("-")[1], 10));
    return [
      {
        type: "playAbility",
        description: `${baseDef.title}: ${baseDef.abilityText.split(".")[0]}`,
        cardDefId: baseDef.id,
        selectableInstanceIds: [baseStack.topCard.instanceId],
        selectablePlayerIndices: playerIndices,
      },
    ];
  }

  // Generate one action per non-player target
  const actions: ValidAction[] = [];
  for (const targetId of targets) {
    const targetDef = findChallengeUnitDef(state, targetId);
    const ownerIdx = findOwnerIndex(state, targetId);
    const ownerTag = ownerIdx !== null && ownerIdx !== playerIndex ? "(opponent's) " : "";
    const targetLabel = targetDef ? cardName(targetDef) : "unit";
    actions.push({
      type: "playAbility",
      description: `${baseDef.title}: ${baseDef.abilityText.split(".")[0]} → ${ownerTag}${targetLabel}`,
      cardDefId: baseDef.id,
      selectableInstanceIds: [baseStack.topCard.instanceId],
      targetInstanceId: targetId,
    });
  }
  return actions;
}

/** Resolve a base ability by abilityId. */
export function resolveBaseAbilityEffect(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  targetInstanceId: string | undefined,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  const handler = registry.get(abilityId);
  if (!handler) {
    log.push(`Base ability ${abilityId} not found in registry.`);
    return;
  }
  handler.resolve(state, playerIndex, targetInstanceId, log, bases);
}

/** Check if any onChallenged trigger is available for the defending player. */
export function getOnChallengedTrigger(
  state: GameState,
  defenderPlayerIndex: number,
  bases: Record<string, BaseCardDef>,
): { abilityId: string; targets: string[] } | null {
  const player = state.players[defenderPlayerIndex];
  const baseDef = bases[player.baseDefId];
  if (!baseDef?.abilityId) return null;

  const handler = registry.get(baseDef.abilityId);
  if (!handler || handler.trigger !== "onChallenged") return null;

  // Base must not be exhausted
  const baseStack = player.zones.resourceStacks[0];
  if (!baseStack || baseStack.exhausted) return null;

  const targets = handler.getTargets(state, defenderPlayerIndex, bases);
  if (!targets || targets.length === 0) return null;

  return { abilityId: baseDef.abilityId, targets };
}

/**
 * Cloud 9, Cruise Ship: commit to reduce influence loss by 1.
 * Returns the adjusted loss amount after applying any reduction.
 */
function interceptCloud9InfluenceLoss(
  state: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
): number {
  if (amount <= 0) return amount;
  const player = state.players[playerIndex];
  for (const stack of player.zones.alert) {
    if (amount <= 0) break;
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = cardRegistryRef[topCard.defId];
    if (!def || def.abilityId !== "cloud9-shield") continue;
    // Commit: move from alert to reserve
    player.zones.alert.splice(player.zones.alert.indexOf(stack), 1);
    player.zones.reserve.push(stack);
    amount = Math.max(0, amount - 1);
    log.push(`Cloud 9, Cruise Ship: committed to reduce influence loss by 1.`);
  }
  return amount;
}

/**
 * Intercept influence loss — checks for I.H.T. Colonial One.
 * Returns the adjusted loss amount after applying any reduction.
 * Auto-exhausts the base if used.
 */
export function interceptInfluenceLoss(
  state: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): number {
  if (amount <= 0) return amount;
  const player = state.players[playerIndex];
  const baseDef = bases[player.baseDefId];
  if (!baseDef?.abilityId) return amount;

  const handler = registry.get(baseDef.abilityId);
  if (!handler?.influenceLossReduction) return amount;

  const baseStack = player.zones.resourceStacks[0];
  if (!baseStack || baseStack.exhausted) return amount;

  baseStack.exhausted = true;
  const reduced = Math.max(0, amount - handler.influenceLossReduction);
  log.push(`${baseDef.title}: Reduced influence loss from ${amount} to ${reduced}.`);
  return reduced;
}

/**
 * Dispatch onCylonReveal to any base with the trigger.
 * Returns true if a pending choice was set up (cylon phase should pause).
 */
export function dispatchOnCylonReveal(
  state: GameState,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): boolean {
  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    const baseDef = bases[player.baseDefId];
    if (!baseDef?.abilityId) continue;

    const handler = registry.get(baseDef.abilityId);
    if (!handler?.onCylonReveal) continue;

    const baseStack = player.zones.resourceStacks[0];
    if (!baseStack || baseStack.exhausted) continue;

    if (handler.onCylonReveal(state, pi, log, bases)) {
      return true;
    }
  }
  return false;
}

/** Check if a base ability is registered and usable in the given context. */
export function isBaseAbilityUsableIn(
  abilityId: string,
  context: "execution" | "challenge" | "cylon-challenge",
): boolean {
  const handler = registry.get(abilityId);
  return handler?.usableIn.includes(context) ?? false;
}

/** Check if the base counts as a Civilian unit (for mission resolve). */
export function hasColonialHeavy798(
  state: GameState,
  playerIndex: number,
  bases: Record<string, BaseCardDef>,
): boolean {
  const player = state.players[playerIndex];
  const baseDef = bases[player.baseDefId];
  if (!baseDef?.abilityId) return false;

  const handler = registry.get(baseDef.abilityId);
  if (!handler?.countsAsCivilian) return false;

  const baseStack = player.zones.resourceStacks[0];
  return !!baseStack && !baseStack.exhausted;
}

/** Exhaust the civilian-counting base (called when mission uses it). */
export function exhaustColonialHeavy798(
  state: GameState,
  playerIndex: number,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  const player = state.players[playerIndex];
  const baseDef = bases[player.baseDefId];
  const baseStack = player.zones.resourceStacks[0];
  if (baseStack) {
    baseStack.exhausted = true;
    log.push(`${baseDef?.title ?? "Base"}: Counts as 1 Civilian unit for mission requirements.`);
  }
}

// --- Internal helpers ---

function findChallengeUnitDef(state: GameState, instanceId: string): CardDef | null {
  for (const player of state.players) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        for (const card of stack.cards) {
          if (card.instanceId === instanceId) {
            return getCardDef(card.defId) ?? null;
          }
        }
      }
    }
  }
  return null;
}

function findOwnerIndex(state: GameState, instanceId: string): number | null {
  const idx = state.players.findIndex((p) =>
    [...p.zones.alert, ...p.zones.reserve].some((stack) =>
      stack.cards.some((c) => c.instanceId === instanceId),
    ),
  );
  return idx === -1 ? null : idx;
}

// ============================================================
// Pending Choice Handlers
// ============================================================

// --- Blockading Base Star: choose threat to block ---
registerPendingChoice("blockading-threat", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Negate: ${cardName(def)} — "${def.cylonThreatText}"`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "Decline — do not use ability" });
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    // Declined
    if (choiceIndex >= choice.cards.length) {
      log.push("Blockading Base Star: Declined.");
      return;
    }
    // Exhaust the base
    const player = state.players[playerIndex];
    const baseStack = player.zones.resourceStacks[0];
    if (baseStack) baseStack.exhausted = true;

    // Find threat index
    const chosenCard = choice.cards[choiceIndex];
    const threatIndex = state.cylonThreats.findIndex(
      (t) => t.card.instanceId === chosenCard.instanceId,
    );
    const def = getCardDef(chosenCard.defId);
    log.push(`Blockading Base Star: Blocking ${def ? cardName(def) : "threat"}'s red text.`);

    // Chain to player selection
    const playerCards = state.players
      .map((p) => p.zones.resourceStacks[0]?.topCard)
      .filter(Boolean) as CardInstance[];
    state.pendingChoice = {
      type: "blockading-player",
      playerIndex,
      cards: playerCards,
      context: { threatIndex },
      prompt: `Blockading Base Star — Choose player to protect from "${def?.cylonThreatText ?? "red text"}"`,
    };
  },
  aiDecide(choice, _choiceActions, state, playerIndex) {
    // Pick the highest-power threat with red text
    let bestIdx = 0;
    let bestPower = -1;
    for (let i = 0; i < choice.cards.length; i++) {
      const threat = state.cylonThreats.find(
        (t) => t.card.instanceId === choice.cards[i].instanceId,
      );
      if (threat && threat.power > bestPower) {
        bestPower = threat.power;
        bestIdx = i;
      }
    }
    return bestIdx; // never decline if there are threats
  },
});

// --- Blockading Base Star: choose player to protect ---
registerPendingChoice("blockading-player", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      actions.push({
        type: "makeChoice",
        description: `Target ${state.playerNames[pi]}`,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const threatIndex = ctx.threatIndex as number;
    state.cylonThreatImmunity = { threatIndex, playerIndex: choiceIndex };
    log.push(
      `Blockading Base Star: ${state.playerNames[choiceIndex]} is protected from threat text.`,
    );
  },
  aiDecide(_choice, _choiceActions, _state, playerIndex) {
    return playerIndex; // protect self
  },
});

registerPendingChoice("celestra", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Keep ${cardName(def)} on top`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    const otherCard = choice.cards[1 - choiceIndex];
    if (chosenCard && otherCard) {
      const chosenDef = getCardDef(chosenCard.defId);
      const otherDef = getCardDef(otherCard.defId);
      player.deck.unshift(chosenCard);
      player.deck.push(otherCard);
      if (chosenDef && otherDef) {
        log.push(
          `${state.playerNames[playerIndex as 0 | 1]} puts ${cardName(chosenDef)} on top and ${cardName(otherDef)} on the bottom.`,
        );
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestMystic = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const mystic = def?.mysticValue ?? 0;
        if (mystic > bestMystic) {
          bestMystic = mystic;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});
