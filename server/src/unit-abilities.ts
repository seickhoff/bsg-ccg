import type {
  GameState,
  CardDef,
  ValidAction,
  UnitStack,
  Trait,
  Keyword,
  PlayerState,
  ChallengeState,
  CardInstance,
  LogItem,
} from "@bsg/shared";
import { hasKeyword, cardName } from "@bsg/shared";
import { unitHasTrait } from "./trait-rules.js";
import { fireMissionOnDraw } from "./mission-abilities.js";
import { findUnitInZone, findUnitInAnyZone } from "./zone-helpers.js";
import { registerPendingChoice, getHelpers } from "./pending-choice-registry.js";

// ============================================================
// BSG CCG — Unit Ability Registry
//
// Open/Closed architecture matching base-abilities.ts:
// Each unit ability registers a handler; the engine calls
// dispatchers at hook points. New abilities = new registrations.
// ============================================================

// --- Handler Interface ---

export interface PowerContext {
  phase?: string;
  isChallenger?: boolean;
  isDefender?: boolean;
  challengerDef?: CardDef;
  defenderDef?: CardDef;
  challengerInstanceId?: string;
  defenderInstanceId?: string;
}

export interface UnitAbilityHandler {
  /** Activation cost for voluntary abilities */
  activation?: {
    cost:
      | "commit"
      | "commit-exhaust"
      | "commit-sacrifice"
      | "commit-other"
      | "sacrifice-other"
      | "exhaust";
    /** Filter for the "other" unit (commit-other / sacrifice-other cost) */
    otherFilter?: (
      def: CardDef,
      state: GameState,
      playerIndex: number,
      instanceId: string,
    ) => boolean;
    /** Contexts where this can be voluntarily activated */
    usableIn: ("execution" | "challenge" | "cylon-challenge")[];
    /** Once-per-turn limitation */
    oncePerTurn?: boolean;
  };

  /** For triggered abilities (engine invokes at hook points) */
  trigger?:
    | "onEnterPlay"
    | "onDefeat"
    | "onChallengeEnd"
    | "onMysticReveal"
    | "onShipEnterPlay"
    | "onUndefended"
    | "onChallengeInit"
    | "onChallengeWin";

  /** Get valid target instanceIds. null = no target, [] = need target but none available */
  getTargets?(state: GameState, playerIndex: number, sourceId: string): string[] | null;

  /** Apply the effect */
  resolve?(
    state: GameState,
    playerIndex: number,
    sourceId: string,
    targetId: string | undefined,
    log: LogItem[],
  ): void;

  /** Passive power modifier */
  getPowerModifier?(
    state: GameState,
    unitStack: UnitStack,
    ownerIndex: number,
    context: PowerContext,
  ): number;

  /** If true, getPowerModifier only applies to the unit that owns this ability (not as an aura). */
  selfOnly?: boolean;

  /** Passive fleet defense modifier */
  fleetDefenseModifier?: number;

  /** Can this unit challenge? false = cannot */
  canChallenge?: false;

  // --- DIP hooks (Phase 3) ---

  /** Freighter resource type — replaces FREIGHTER_RESOURCE map in game-engine.ts */
  freighterResource?: "security" | "logistics" | "persuasion";

  /** Power buff when used as commit-other cost (default 1, sacrifice-other always 3) */
  commitOtherPowerBuff?: number;

  /** Can be flash-played from hand to defend against a ship challenger */
  canFlashPlayToDefend?: boolean;

  /** This unit's trigger acts as a challenge pending trigger (different from base triggers) */
  isChallengePendingTrigger?: boolean;

  /** Commit this unit to reduce influence loss by 1 */
  interceptInfluenceLoss?: boolean;
}

// --- Registry ---

const registry = new Map<string, UnitAbilityHandler>();

function register(abilityId: string, handler: UnitAbilityHandler): void {
  registry.set(abilityId, handler);
}

// --- Card Def Helper (avoid circular imports) ---

let cardRegistryRef: Record<string, CardDef> = {};

export function setUnitAbilityCardRegistry(cards: Record<string, CardDef>): void {
  cardRegistryRef = cards;
}

type InfluenceLossFn = (
  state: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
) => void;

let applyInfluenceLossFn: InfluenceLossFn | null = null;

export function setUnitAbilityInfluenceLoss(fn: InfluenceLossFn): void {
  applyInfluenceLossFn = fn;
}

function getCardDef(defId: string): CardDef | undefined {
  return cardRegistryRef[defId];
}

function getUnitPowerBasic(stack: UnitStack): number {
  const topCard = stack.cards[0];
  if (!topCard) return 0;
  return getCardDef(topCard.defId)?.power ?? 0;
}

/** Cloud 9, Cruise Ship: commit to reduce influence loss by 1. */
function interceptCloud9Loss(
  state: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
): number {
  if (amount <= 0) return amount;
  const player = state.players[playerIndex];
  for (let i = player.zones.alert.length - 1; i >= 0; i--) {
    if (amount <= 0) break;
    const stack = player.zones.alert[i];
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (!def || def.abilityId !== "cloud9-shield") continue;
    // Commit: move from alert to reserve
    player.zones.alert.splice(i, 1);
    player.zones.reserve.push(stack);
    amount = Math.max(0, amount - 1);
    log.push(`Cloud 9, Cruise Ship: committed to reduce influence loss by 1.`);
  }
  return amount;
}

/** Get all face-up alert unit stacks for a player */
function getAlertUnits(
  player: PlayerState,
): { stack: UnitStack; def: CardDef; instanceId: string }[] {
  const results: { stack: UnitStack; def: CardDef; instanceId: string }[] = [];
  for (const stack of player.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard?.faceUp) {
      const def = getCardDef(topCard.defId);
      if (def) results.push({ stack, def, instanceId: topCard.instanceId });
    }
  }
  return results;
}

/** Count Pilots controlled by player (in alert or reserve, face-up) */
function countTraitUnits(
  state: GameState,
  player: PlayerState,
  trait: Trait,
  excludeInstanceId?: string,
): number {
  let count = 0;
  for (const zone of [player.zones.alert, player.zones.reserve]) {
    for (const stack of zone) {
      const topCard = stack.cards[0];
      if (topCard?.faceUp && topCard.instanceId !== excludeInstanceId) {
        const def = getCardDef(topCard.defId);
        if (unitHasTrait(state, topCard.instanceId, def, trait)) count++;
      }
    }
  }
  return count;
}

/** Check if player controls an alert unit with a given title */
function hasAlertUnitWithTitle(player: PlayerState, title: string): boolean {
  for (const stack of player.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard?.faceUp) {
      const def = getCardDef(topCard.defId);
      if (def?.title === title) return true;
    }
  }
  return false;
}

/** Check if player has any other alert face-up personnel */
function hasOtherAlertPersonnel(player: PlayerState, excludeInstanceId: string): boolean {
  for (const stack of player.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard?.faceUp && topCard.instanceId !== excludeInstanceId) {
      const def = getCardDef(topCard.defId);
      if (def?.type === "personnel") return true;
    }
  }
  return false;
}

/** Move a unit from reserve to alert */
export function readyUnit(player: PlayerState, instanceId: string, log?: LogItem[]): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && found.zone === "reserve") {
    player.zones.reserve.splice(found.index, 1);
    player.zones.alert.push(found.stack);
    if (log) {
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? cardName(def) : "Unit"} readied.`);
    }
    return true;
  }
  return false;
}

/** Move a unit from alert to reserve */
function commitUnit(player: PlayerState, instanceId: string, log?: LogItem[]): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && found.zone === "alert") {
    player.zones.alert.splice(found.index, 1);
    player.zones.reserve.push(found.stack);
    if (log) {
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? cardName(def) : "Unit"} committed.`);
    }
    return true;
  }
  return false;
}

/** Defeat a unit (move to discard) */
function defeatUnitLocal(player: PlayerState, instanceId: string, log: LogItem[]): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (found) {
    const def = getCardDef(found.stack.cards[0].defId);
    log.push(`${def ? cardName(def) : "Unit"} is defeated.`);
    const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
    zone.splice(found.index, 1);
    for (const card of found.stack.cards) {
      player.discard.push(card);
    }
    return true;
  }
  return false;
}

/** Find all face-up alert/reserve units matching a filter for ALL players or specific player */
function findTargetUnits(
  state: GameState,
  playerIndex: number,
  filter: (def: CardDef, stack: UnitStack, ownerIndex: number) => boolean,
  options?: {
    ownOnly?: boolean;
    excludeSourceId?: string;
    alertOnly?: boolean;
    reserveOnly?: boolean;
  },
): string[] {
  const results: string[] = [];
  const players = options?.ownOnly
    ? [{ p: state.players[playerIndex], idx: playerIndex }]
    : state.players.map((p, idx) => ({ p, idx }));

  for (const { p, idx } of players) {
    const zones = options?.reserveOnly
      ? [p.zones.reserve]
      : options?.alertOnly
        ? [p.zones.alert]
        : [p.zones.alert, p.zones.reserve];
    for (const zone of zones) {
      for (const stack of zone) {
        const topCard = stack.cards[0];
        if (topCard?.faceUp && topCard.instanceId !== options?.excludeSourceId) {
          const def = getCardDef(topCard.defId);
          if (def && filter(def, stack, idx)) {
            results.push(topCard.instanceId);
          }
        }
      }
    }
  }
  return results;
}

/** Draw cards from deck (handles reshuffle) */
function drawCards(
  player: PlayerState,
  count: number,
  log: LogItem[],
  playerLabel: string,
  state?: GameState,
  playerIndex?: number,
): void {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) return;
      player.deck = [...player.discard];
      player.discard = [];
      // Simple shuffle
      for (let j = player.deck.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
      }
      log.push(`${playerLabel} reshuffled discard pile into deck.`);
    }
    const card = player.deck.shift()!;
    player.hand.push(card);
  }
  // Tightening the Noose: fire onDraw hook during execution phase
  if (state && playerIndex !== undefined && state.phase === "execution") {
    fireMissionOnDraw(state, playerIndex, count, log);
  }
}

// ============================================================
// ACTIVATED ABILITY REGISTRATIONS
// ============================================================

// --- Pattern 1: Commit: Power Buff ---

// Crashdown Expert ECO / D'Anna Fleet News / Adama Patriotic Soldier
// "Commit: Choose target other unit. If that unit is challenging, it gets +2 power."
for (const [id] of [["crashdown-buff"], ["danna-buff"], ["adama-commit"]] as const) {
  register(id, {
    activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
    getTargets(state, playerIndex, sourceId) {
      // Target: any other face-up alert unit (any player) that is currently challenging
      if (!state.challenge) {
        // During execution, target any other alert unit (buff applies when they challenge)
        return findTargetUnits(
          state,
          playerIndex,
          (def) => def.type === "personnel" || def.type === "ship",
          { excludeSourceId: sourceId },
        );
      }
      // During challenge, only target the challenger
      const targets: string[] = [];
      if (state.challenge.challengerInstanceId !== sourceId) {
        targets.push(state.challenge.challengerInstanceId);
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, _sourceId, targetId, log) {
      if (!targetId) return;
      if (state.challenge) {
        if (targetId === state.challenge.challengerInstanceId) {
          state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 2;
          log.push("Challenger gets +2 power.");
        }
      }
      // Outside challenge, the +2 buff is tracked via challenge buff when they challenge
      // (effect lasts until end of phase per rules)
    },
  });
}

// Dee Security Advisor / Laura Roslin Secretary of Ed: "Commit: Target other personnel gets +2 power."
for (const id of ["dee-buff", "roslin-buff"]) {
  register(id, {
    activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
    getTargets(state, playerIndex, sourceId) {
      if (state.challenge) {
        // During challenge, buff challenger or defender
        const targets: string[] = [];
        if (state.challenge.challengerInstanceId !== sourceId) {
          const cDef = findDefByInstanceId(state, state.challenge.challengerInstanceId);
          if (cDef?.type === "personnel") targets.push(state.challenge.challengerInstanceId);
        }
        if (state.challenge.defenderInstanceId && state.challenge.defenderInstanceId !== sourceId) {
          const dDef = findDefByInstanceId(state, state.challenge.defenderInstanceId);
          if (dDef?.type === "personnel") targets.push(state.challenge.defenderInstanceId);
        }
        return targets.length > 0 ? targets : [];
      }
      return findTargetUnits(state, playerIndex, (def) => def.type === "personnel", {
        excludeSourceId: sourceId,
      });
    },
    resolve(state, _pi, _sid, targetId, log) {
      if (!targetId || !state.challenge) return;
      applyChallengePowerBuff(state, targetId, 2, log);
    },
  });
}

// Helo Flight Officer: "Commit: Target Pilot gets +2 power."
register("helo-buff", {
  activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
  getTargets(state, playerIndex, sourceId) {
    if (state.challenge) {
      const targets: string[] = [];
      for (const id of [state.challenge.challengerInstanceId, state.challenge.defenderInstanceId]) {
        if (id && id !== sourceId) {
          const def = findDefByInstanceId(state, id);
          if (unitHasTrait(state, id, def, "Pilot" as Trait)) targets.push(id);
        }
      }
      return targets.length > 0 ? targets : [];
    }
    return findTargetUnits(
      state,
      playerIndex,
      (def, stack) => unitHasTrait(state, stack.cards[0].instanceId, def, "Pilot" as Trait),
      {
        excludeSourceId: sourceId,
      },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    applyChallengePowerBuff(state, targetId, 2, log);
  },
});

// Ellen Tigh Power Behind XO: "Commit: Target Officer gets +2 power."
register("ellen-buff", {
  activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
  getTargets(state, playerIndex, sourceId) {
    if (state.challenge) {
      const targets: string[] = [];
      for (const id of [state.challenge.challengerInstanceId, state.challenge.defenderInstanceId]) {
        if (id && id !== sourceId) {
          const def = findDefByInstanceId(state, id);
          if (unitHasTrait(state, id, def, "Officer" as Trait)) targets.push(id);
        }
      }
      return targets.length > 0 ? targets : [];
    }
    return findTargetUnits(
      state,
      playerIndex,
      (def, stack) => unitHasTrait(state, stack.cards[0].instanceId, def, "Officer" as Trait),
      {
        excludeSourceId: sourceId,
      },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    applyChallengePowerBuff(state, targetId, 2, log);
  },
});

// Helo Protector: "Commit: Target other defending personnel gets +2 power."
register("helo-protect", {
  activation: { cost: "commit", usableIn: ["challenge"] },
  getTargets(state, _pi, sourceId) {
    if (!state.challenge?.defenderInstanceId) return [];
    if (state.challenge.defenderInstanceId === sourceId) return [];
    const def = findDefByInstanceId(state, state.challenge.defenderInstanceId);
    if (def?.type === "personnel") return [state.challenge.defenderInstanceId];
    return [];
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    applyChallengePowerBuff(state, targetId, 2, log);
  },
});

// --- Pattern 2: Commit: Simple Effects ---

// Boomer Saboteur: "Commit: All players lose 1 influence."
register("boomer-saboteur", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets: () => null,
  resolve(state, _pi, _sid, _tid, log) {
    for (let i = 0; i < state.players.length; i++) {
      applyInfluenceLossFn!(state, i, 1, log);
    }
  },
});

// Laura Roslin Colonial President: "Commit: Draw a card."
register("roslin-draw", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    drawCards(
      state.players[playerIndex],
      1,
      log,
      `${state.playerNames[playerIndex as 0 | 1]}`,
      state,
      playerIndex,
    );
    log.push(`${state.playerNames[playerIndex as 0 | 1]} draws a card.`);
  },
});

// Laura Roslin Madame President: "Commit: Gain 1 influence."
register("roslin-influence", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    if (state.preventInfluenceGain) {
      log.push(`${state.preventInfluenceGain}: influence gain prevented.`);
      return;
    }
    state.players[playerIndex].influence += 1;
    log.push(
      `${state.playerNames[playerIndex as 0 | 1]} gains 1 influence. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// Centurion Ambusher: "Commit: Target Cylon threat gets +2 power."
register("centurion-ambush", {
  activation: { cost: "commit", usableIn: ["cylon-challenge"] },
  getTargets(state) {
    if (!state.cylonThreats.length) return [];
    return state.cylonThreats.map((_, i) => `threat-${i}`);
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    const idx = parseInt(targetId.replace("threat-", ""), 10);
    if (state.cylonThreats[idx]) {
      state.cylonThreats[idx].power += 2;
      log.push("Cylon threat gets +2 power.");
    }
  },
});

// Centurion Harasser: "Commit: Commit target personnel."
register("centurion-harass", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def) => def.type === "personnel", {
      excludeSourceId: sourceId,
      alertOnly: true,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (commitUnit(p, targetId, log)) {
        break;
      }
    }
  },
});

// --- Pattern 3: Commit: Target Manipulation ---

// Dr. Baltar Science Advisor: "Commit: Defeat target exhausted personnel."
register("baltar-defeat", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, _pi, sourceId) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const topCard = stack.cards[0];
          if (topCard?.instanceId !== sourceId && stack.exhausted) {
            const def = getCardDef(topCard.defId);
            if (def?.type === "personnel") targets.push(topCard.instanceId);
          }
        }
      }
    }
    return targets;
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (defeatUnitLocal(p, targetId, log)) break;
    }
  },
});

// Galen Tyrol CPO: "Commit: Ready target ship."
register("tyrol-ready", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, playerIndex) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "ship", {
      ownOnly: true,
      reserveOnly: true,
    });
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    readyUnit(state.players[playerIndex], targetId, log);
  },
});

// Number Six Secret Companion: "Vision + Commit: Exhaust target other personnel."
register("six-exhaust", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def, stack) => def.type === "personnel" && !stack.exhausted, {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found) {
        found.stack.exhausted = true;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Personnel"} exhausted.`);
        break;
      }
    }
  },
});

// Cally Cheerful Mechanic: "Commit: Restore target ship."
register("cally-restore", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, playerIndex) {
    const targets: string[] = [];
    const player = state.players[playerIndex];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        if (stack.exhausted) {
          const def = getCardDef(stack.cards[0]?.defId);
          if (def?.type === "ship") targets.push(stack.cards[0].instanceId);
        }
      }
    }
    return targets;
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetId);
    if (found) {
      found.stack.exhausted = false;
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? cardName(def) : "Ship"} restored.`);
    }
  },
});

// Doral Tour Guide: "Commit: Exhaust target ship."
register("doral-exhaust", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def, stack) => def.type === "ship" && !stack.exhausted, {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found) {
        found.stack.exhausted = true;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Ship"} exhausted.`);
        break;
      }
    }
  },
});

// Dr. Cottle Bearer of Bad News: "Commit: Target personnel gets -2 power."
register("cottle-debuff", {
  activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
  getTargets(state, _pi, sourceId) {
    if (state.challenge) {
      const targets: string[] = [];
      for (const id of [state.challenge.challengerInstanceId, state.challenge.defenderInstanceId]) {
        if (id && id !== sourceId) {
          const def = findDefByInstanceId(state, id);
          if (def?.type === "personnel") targets.push(id);
        }
      }
      return targets.length > 0 ? targets : [];
    }
    return findTargetUnits(state, 0, (def) => def.type === "personnel", {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    applyChallengePowerBuff(state, targetId, -2, log);
  },
});

// --- Commit: Ready/Restore/Mission ---

// Laura Roslin Instigator: "Commit: Ready target mission."
register("roslin-mission", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const stack of player.zones.reserve) {
      const topCard = stack.cards[0];
      if (topCard?.faceUp) {
        const def = getCardDef(topCard.defId);
        if (def?.type === "mission") targets.push(topCard.instanceId);
      }
    }
    return targets;
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    readyUnit(state.players[playerIndex], targetId, log);
  },
});

// Simon Caring Doctor: "Commit: Restore target personnel."
register("simon-restore", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, playerIndex) {
    const targets: string[] = [];
    const player = state.players[playerIndex];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        if (stack.exhausted) {
          const def = getCardDef(stack.cards[0]?.defId);
          if (def?.type === "personnel") targets.push(stack.cards[0].instanceId);
        }
      }
    }
    return targets;
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetId);
    if (found) {
      found.stack.exhausted = false;
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? cardName(def) : "Personnel"} restored.`);
    }
  },
});

// Mr. Gaeta Brilliant Officer: "Commit: Cylon threat of target card gets -1 until end of turn."
register("gaeta-cylon-reduce", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    // Target any face-up unit with cylonThreat > 0
    return findTargetUnits(
      state,
      0,
      (def) => (def.type === "personnel" || def.type === "ship") && (def.cylonThreat ?? 0) > 0,
      { excludeSourceId: sourceId },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    // Find which player owns this unit
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found) {
        if (!p.temporaryCylonThreatMods) p.temporaryCylonThreatMods = {};
        p.temporaryCylonThreatMods[targetId] = (p.temporaryCylonThreatMods[targetId] ?? 0) - 1;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Card"} Cylon threat -1 this turn.`);
        break;
      }
    }
  },
});

// --- Commit: Keyword/Trait Grants ---

// Apollo Distant Son: "Commit: Target other personnel gains Strafe."
register("apollo-strafe", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "personnel", {
      ownOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    if (!player.temporaryKeywordGrants) player.temporaryKeywordGrants = {};
    const existing = player.temporaryKeywordGrants[targetId] ?? [];
    if (!existing.includes("Strafe")) existing.push("Strafe");
    player.temporaryKeywordGrants[targetId] = existing;
    const def = findDefByInstanceIdFromPlayers(state, targetId);
    log.push(`${def ? cardName(def) : "Personnel"} gains Strafe.`);
  },
});

// Leoben Snake in the Grass: "Commit: Target personnel gains the Cylon trait."
register("leoben-cylon", {
  activation: { cost: "commit", usableIn: ["execution", "challenge"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def) => def.type === "personnel", {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    // Find which player owns the target
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found) {
        if (!p.temporaryTraitGrants) p.temporaryTraitGrants = {};
        const existing = p.temporaryTraitGrants[targetId] ?? [];
        if (!existing.includes("Cylon")) existing.push("Cylon");
        p.temporaryTraitGrants[targetId] = existing;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Personnel"} gains the Cylon trait.`);
        break;
      }
    }
  },
});

// William Adama Tactician: "Commit: Target other personnel gains Sniper."
register("adama-sniper", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "personnel", {
      ownOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    if (!player.temporaryKeywordGrants) player.temporaryKeywordGrants = {};
    const existing = player.temporaryKeywordGrants[targetId] ?? [];
    if (!existing.includes("Sniper")) existing.push("Sniper");
    player.temporaryKeywordGrants[targetId] = existing;
    const def = findDefByInstanceIdFromPlayers(state, targetId);
    log.push(`${def ? cardName(def) : "Personnel"} gains Sniper.`);
  },
});

// --- Commit+Exhaust: Discard/Deck Recovery ---

// Crashdown Sensor Operator: "Commit and exhaust: Put target card from your discard pile into your hand."
register("crashdown-recover", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    return state.players[playerIndex].discard.length > 0
      ? state.players[playerIndex].discard.map((c) => c.instanceId)
      : [];
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const idx = player.discard.findIndex((c) => c.instanceId === targetId);
    if (idx >= 0) {
      const [card] = player.discard.splice(idx, 1);
      player.hand.push(card);
      const def = getCardDef(card.defId);
      log.push(
        `${state.playerNames[playerIndex as 0 | 1]} recovers ${def ? cardName(def) : "a card"} from discard.`,
      );
    }
  },
});

// Dr. Baltar Award Winner: "Commit and exhaust: Put target personnel card from your discard pile into your hand."
register("baltar-recover", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    return state.players[playerIndex].discard
      .filter((c) => getCardDef(c.defId)?.type === "personnel")
      .map((c) => c.instanceId);
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const idx = player.discard.findIndex((c) => c.instanceId === targetId);
    if (idx >= 0) {
      const [card] = player.discard.splice(idx, 1);
      player.hand.push(card);
      const def = getCardDef(card.defId);
      log.push(
        `${state.playerNames[playerIndex as 0 | 1]} recovers ${def ? cardName(def) : "personnel"} from discard.`,
      );
    }
  },
});

// Dr. Cottle Doc: "Commit and exhaust: Put target personnel from your discard pile into your hand."
register("cottle-recover", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    return state.players[playerIndex].discard
      .filter((c) => getCardDef(c.defId)?.type === "personnel")
      .map((c) => c.instanceId);
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const idx = player.discard.findIndex((c) => c.instanceId === targetId);
    if (idx >= 0) {
      const [card] = player.discard.splice(idx, 1);
      player.hand.push(card);
      const def = getCardDef(card.defId);
      log.push(
        `${state.playerNames[playerIndex as 0 | 1]} recovers ${def ? cardName(def) : "personnel"} from discard.`,
      );
    }
  },
});

// Boomer Savior: "Commit and exhaust: Search your deck for a personnel card and put it into your hand."
register("boomer-search", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    const player = state.players[playerIndex];
    // Find all personnel cards in deck
    const personnel: import("@bsg/shared").CardInstance[] = [];
    for (const card of player.deck) {
      const def = getCardDef(card.defId);
      if (def?.type === "personnel") personnel.push(card);
    }
    if (personnel.length === 0) {
      log.push("Boomer: No personnel found in deck.");
      return;
    }
    log.push("Boomer: Searching deck for a personnel card...");
    state.pendingChoice = {
      type: "boomer-search",
      playerIndex,
      cards: personnel,
      prompt: "Boomer — choose a personnel card to add to your hand",
    };
  },
});

// --- Commit+Exhaust: Target Effects ---

// Number Six Caprican Operative: "Commit and exhaust: Ready target other Cylon personnel."
register("six-ready-cylon", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(
      state,
      playerIndex,
      (def, stack) =>
        def.type === "personnel" &&
        unitHasTrait(state, stack.cards[0].instanceId, def, "Cylon" as Trait),
      { ownOnly: true, reserveOnly: true, excludeSourceId: sourceId },
    );
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    readyUnit(state.players[playerIndex], targetId, log);
  },
});

// Saul Tigh Disciplinarian: "Commit and exhaust: Commit and exhaust target personnel."
register("tigh-lockdown", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def, stack) => def.type === "personnel" && !stack.exhausted, {
      alertOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found && found.zone === "alert") {
        commitUnit(p, targetId, log);
        // Re-find after commit
        const found2 = findUnitInAnyZone(p, targetId);
        if (found2) found2.stack.exhausted = true;
        break;
      }
    }
  },
});

// Starbuck Maverick: "Commit and exhaust: Put target alert personnel into its owner's hand."
register("starbuck-bounce", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(state, 0, (def) => def.type === "personnel", {
      alertOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found && found.zone === "alert") {
        p.zones.alert.splice(found.index, 1);
        // Return all cards in stack to hand
        for (const card of found.stack.cards) {
          p.hand.push(card);
        }
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Personnel"} returned to hand.`);
        break;
      }
    }
  },
});

// Starbuck Resistance Fighter: "Commit and exhaust: Exhaust target resource stack."
register("starbuck-sabotage", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    // Target opponent's resource stacks
    const oppIndex = 1 - playerIndex;
    const targets: string[] = [];
    const opp = state.players[oppIndex];
    for (let i = 0; i < opp.zones.resourceStacks.length; i++) {
      if (!opp.zones.resourceStacks[i].exhausted) {
        targets.push(`rstack-${oppIndex}-${i}`);
      }
    }
    return targets;
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const parts = targetId.split("-");
    const pIdx = parseInt(parts[1], 10);
    const sIdx = parseInt(parts[2], 10);
    const stack = state.players[pIdx]?.zones.resourceStacks[sIdx];
    if (stack) {
      stack.exhausted = true;
      log.push(`${state.playerNames[pIdx as 0 | 1]}'s resource stack exhausted.`);
    }
  },
});

// Starbuck Uncooperative Patient: "Commit and exhaust: Defeat target Cylon personnel."
register("starbuck-slay", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(
      state,
      0,
      (def, stack) =>
        def.type === "personnel" &&
        unitHasTrait(state, stack.cards[0].instanceId, def, "Cylon" as Trait),
      { excludeSourceId: sourceId },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (defeatUnitLocal(p, targetId, log)) break;
    }
  },
});

// --- Commit-Other-As-Cost ---

// Dr. Baltar Defense Contractor: "Commit target other personnel you control: This personnel gets +1 power."
register("baltar-boost", {
  activation: {
    cost: "commit-other",
    otherFilter: (def) => def.type === "personnel",
    usableIn: ["execution", "challenge"],
  },
  getTargets(state, playerIndex, sourceId) {
    // The "target" IS the other personnel to commit as cost
    return findTargetUnits(state, playerIndex, (def) => def.type === "personnel", {
      ownOnly: true,
      alertOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    // targetId is the committed unit. Self gets +1 power.
    // Power buff handled via challenge state if in challenge
    if (state.challenge) {
      // Apply to the source unit — but we need the source instanceId
      // The engine handles committing the other unit as cost
      log.push("Dr. Baltar gets +1 power.");
    }
  },
});

// Centurion Hunter: "Commit target other Cylon personnel you control: +2 power. Once per turn."
register("centurion-hunt", {
  commitOtherPowerBuff: 2,
  activation: {
    cost: "commit-other",
    otherFilter: (def, state, _pi, instanceId) =>
      def.type === "personnel" && unitHasTrait(state, instanceId, def, "Cylon" as Trait),
    usableIn: ["execution", "challenge"],
    oncePerTurn: true,
  },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(
      state,
      playerIndex,
      (def, stack) =>
        def.type === "personnel" &&
        unitHasTrait(state, stack.cards[0].instanceId, def, "Cylon" as Trait),
      { ownOnly: true, alertOnly: true, excludeSourceId: sourceId },
    );
  },
  resolve(state, _pi, _sid, _tid, log) {
    if (state.challenge) {
      log.push("Centurion Hunter gets +2 power.");
    }
  },
});

// Dr. Baltar Survivor: "Sacrifice target alert personnel: +3 power. Once per turn."
register("baltar-sacrifice", {
  activation: {
    cost: "sacrifice-other",
    otherFilter: (def) => def.type === "personnel",
    usableIn: ["execution", "challenge"],
    oncePerTurn: true,
  },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "personnel", {
      ownOnly: true,
      alertOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, _tid, log) {
    if (state.challenge) {
      log.push("Dr. Baltar gets +3 power.");
    }
  },
});

// --- Challenge-Only Abilities ---

// Dr. Cottle Military Surgeon: "Commit during challenge: loser exhausted instead of defeated."
register("cottle-surgeon", {
  activation: { cost: "commit", usableIn: ["challenge"] },
  getTargets: () => null,
  resolve(state, _pi, _sid, _tid, log) {
    if (state.challenge) {
      state.challenge.losesExhaustedNotDefeated = true;
      log.push("Dr. Cottle: The losing unit will be exhausted instead of defeated.");
    }
  },
});

// Elosha Priestess: "Commit during a challenge: double mystic value reveal."
register("elosha-double", {
  activation: { cost: "commit", usableIn: ["challenge"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    if (state.challenge) {
      state.challenge.doubleMysticReveal = playerIndex;
      log.push("Elosha: Will reveal double mystic value this challenge.");
    }
  },
});

// --- Cylon Phase Abilities ---

// Mr. Gaeta Tactical Officer: "Commit: target other unit challenging Cylon threat +2 power."
register("gaeta-cylon-buff", {
  activation: { cost: "commit", usableIn: ["cylon-challenge"] },
  getTargets(state, _pi, sourceId) {
    if (!state.challenge?.isCylonChallenge) return [];
    if (state.challenge.challengerInstanceId === sourceId) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    applyChallengePowerBuff(state, targetId, 2, log);
  },
});

// Apollo Man Of The Hour: "Commit: Put target Cylon threat into discard. Challenge ends."
register("apollo-dismiss", {
  activation: { cost: "commit", usableIn: ["cylon-challenge"] },
  getTargets(state) {
    if (!state.challenge?.isCylonChallenge) return [];
    if (state.challenge.cylonThreatIndex === undefined) return [];
    return [`threat-${state.challenge.cylonThreatIndex}`];
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !state.challenge?.isCylonChallenge) return;
    const idx = state.challenge.cylonThreatIndex!;
    if (state.cylonThreats[idx]) {
      const threat = state.cylonThreats[idx];
      state.players[threat.ownerIndex].discard.push(threat.card);
      state.cylonThreats.splice(idx, 1);
      log.push("Apollo dismisses the Cylon threat. Challenge ends.");
      // Commit the challenger
      const challenger = state.players[state.challenge.challengerPlayerIndex];
      commitUnit(challenger, state.challenge.challengerInstanceId, log);
      state.challenge = null;
    }
  },
});

// --- Dr. Baltar Vice President (DUAL ability) ---
register("baltar-vp", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    // Two abilities: move mission to reserve OR ready mission
    // Return missions in alert (to commit to reserve) and missions in reserve (to ready)
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const stack of player.zones.alert) {
      const def = getCardDef(stack.cards[0]?.defId);
      if (def?.type === "mission") targets.push(stack.cards[0].instanceId);
    }
    for (const stack of player.zones.reserve) {
      const def = getCardDef(stack.cards[0]?.defId);
      if (def?.type === "mission") targets.push(stack.cards[0].instanceId);
    }
    return targets;
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Check if target is in alert → commit to reserve
    const alertFound = findUnitInZone(player.zones.alert, targetId);
    if (alertFound) {
      const [stack] = player.zones.alert.splice(alertFound.index, 1);
      player.zones.reserve.push(stack);
      const def = getCardDef(stack.cards[0].defId);
      log.push(`Dr. Baltar moves ${def ? cardName(def) : "mission"} to reserve.`);
      return;
    }
    // Check if target is in reserve → ready (move to alert)
    readyUnit(player, targetId, log);
  },
});

// --- Number Six Agent Provocateur: "Vision + Commit and sacrifice: 2 extra actions." ---
register("six-agent", {
  activation: { cost: "commit-sacrifice", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    state.players[playerIndex].extraActionsRemaining =
      (state.players[playerIndex].extraActionsRemaining ?? 0) + 2;
    log.push("Number Six: Take 2 extra actions.");
  },
});

// --- Shelley Godfrey: "Commit: Target opponent reveals hand. Choose a personnel card and put it on top of that player's deck." ---
register("godfrey-reveal", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    const oppIndex = 1 - playerIndex;
    const opp = state.players[oppIndex];
    // Find personnel in opponent's hand
    const personnel: import("@bsg/shared").CardInstance[] = [];
    for (const card of opp.hand) {
      const def = getCardDef(card.defId);
      if (def?.type === "personnel") personnel.push(card);
    }
    const handNames = opp.hand
      .map((c) => {
        const d = getCardDef(c.defId);
        return d ? cardName(d) : "unknown";
      })
      .join(", ");
    log.push(`Godfrey: Opponent reveals hand: ${handNames || "(empty)"}`);
    if (personnel.length === 0) {
      log.push("Godfrey: No personnel in opponent's hand.");
      return;
    }
    state.pendingChoice = {
      type: "godfrey-reveal",
      playerIndex,
      cards: personnel,
      context: { opponentIndex: oppIndex },
      prompt: "Godfrey — choose a personnel to discard from opponent's hand",
    };
  },
});

// --- Elosha Guide to the Prophet: "Commit: Reveal top card, target unit gets +X power." ---
register("elosha-mystic-buff", {
  activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
  getTargets(state, _pi, sourceId) {
    if (state.challenge) {
      const targets: string[] = [];
      if (state.challenge.challengerInstanceId !== sourceId) {
        targets.push(state.challenge.challengerInstanceId);
      }
      if (state.challenge.defenderInstanceId && state.challenge.defenderInstanceId !== sourceId) {
        targets.push(state.challenge.defenderInstanceId);
      }
      return targets.length > 0 ? targets : [];
    }
    return findTargetUnits(state, 0, (def) => def.type === "personnel" || def.type === "ship", {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Reveal top card
    if (player.deck.length === 0 && player.discard.length === 0) return;
    if (player.deck.length === 0) {
      player.deck = [...player.discard];
      player.discard = [];
      for (let j = player.deck.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
      }
    }
    const card = player.deck.shift()!;
    const revealedDef = getCardDef(card.defId);
    const mysticValue = revealedDef?.mysticValue ?? 0;
    player.discard.push(card);
    log.push(
      `Elosha reveals ${revealedDef ? cardName(revealedDef) : "card"} (mystic value ${mysticValue}).`,
    );
    if (state.challenge && mysticValue > 0) {
      applyChallengePowerBuff(state, targetId, mysticValue, log);
    }
  },
});

// --- Hadrian Head Of Tribunal: "Commit: Commit and exhaust target personnel with power 2 or less." ---
register("hadrian-tribunal", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(
      state,
      0,
      (def, stack) => def.type === "personnel" && (def.power ?? 0) <= 2 && !stack.exhausted,
      { alertOnly: true, excludeSourceId: sourceId },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found && found.zone === "alert") {
        commitUnit(p, targetId, log);
        const found2 = findUnitInAnyZone(p, targetId);
        if (found2) found2.stack.exhausted = true;
        break;
      }
    }
  },
});

// --- Hadrian Investigator: "Commit: Commit and exhaust target Enlisted or Cylon personnel." ---
register("hadrian-investigate", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    return findTargetUnits(
      state,
      0,
      (def, stack) =>
        def.type === "personnel" &&
        !stack.exhausted &&
        (unitHasTrait(state, stack.cards[0].instanceId, def, "Enlisted" as Trait) ||
          unitHasTrait(state, stack.cards[0].instanceId, def, "Cylon" as Trait)),
      { alertOnly: true, excludeSourceId: sourceId },
    );
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found && found.zone === "alert") {
        commitUnit(p, targetId, log);
        const found2 = findUnitInAnyZone(p, targetId);
        if (found2) found2.stack.exhausted = true;
        break;
      }
    }
  },
});

// ============================================================
// PASSIVE ABILITY REGISTRATIONS
// ============================================================

// Apollo CAG: "All other Pilots you control get +1 power."
register("apollo-cag", {
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (!unitHasTrait(state, topCard.instanceId, def, "Pilot" as Trait)) return 0;
    // Check if owner has Apollo CAG in play (not this unit)
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "apollo-cag") return 1;
        }
      }
    }
    return 0;
  },
});

// Billy Press Secretary: "While defending, this personnel gets +2 power."
register("billy-defend", {
  getPowerModifier(_state, _unitStack, _ownerIndex, context) {
    return context.isDefender ? 2 : 0;
  },
});

// Cylon Centurion: "While challenging, this personnel gets +2 power."
register("centurion-aggro", {
  getPowerModifier(_state, _unitStack, _ownerIndex, context) {
    return context.isChallenger ? 2 : 0;
  },
});

// Dee Dradis Operator: "During the Cylon phase, this personnel gets +2 power."
register("dee-cylon", {
  getPowerModifier(state) {
    return state.phase === "cylon" ? 2 : 0;
  },
});

// Helo Raptor ECO: "This personnel gets +3 power while challenging a Cylon personnel."
register("helo-anticylon", {
  getPowerModifier(state, _unitStack, _ownerIndex, context) {
    if (!context.isChallenger || !context.defenderDef || !context.defenderInstanceId) return 0;
    if (
      context.defenderDef.type === "personnel" &&
      unitHasTrait(state, context.defenderInstanceId, context.defenderDef, "Cylon" as Trait)
    )
      return 3;
    return 0;
  },
});

// Starbuck Hotshot Pilot: "This personnel gets +1 power for each other Pilot you control."
register("starbuck-hotshot", {
  selfOnly: true,
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    return countTraitUnits(state, state.players[ownerIndex], "Pilot", topCard.instanceId);
  },
});

// William Adama The Old Man: "While you control another alert personnel, +2 power."
register("adama-oldman", {
  selfOnly: true,
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    return hasOtherAlertPersonnel(state.players[ownerIndex], topCard.instanceId) ? 2 : 0;
  },
});

// Anders Resistance Leader: "All other Civilian units you control get +1 power."
register("anders-leader", {
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (!unitHasTrait(state, topCard.instanceId, def, "Civilian" as Trait)) return 0;
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "anders-leader") return 1;
        }
      }
    }
    return 0;
  },
});

// Boomer Human-Lover: "While you control an alert Helo, +1 power."
register("boomer-helo", {
  getPowerModifier(state, _unitStack, ownerIndex) {
    return hasAlertUnitWithTitle(state.players[ownerIndex], "Helo") ? 1 : 0;
  },
});

// Apollo Political Liaison: "All other Officers you control gain the Politician trait."
register("apollo-politician", {
  // This is a passive trait grant — handled by getEffectiveTraits dispatcher
});

// D'Anna Reporter: "This personnel cannot challenge."
register("danna-noattack", {
  canChallenge: false,
});

// Hadrian Master-At-Arms: "The fleet defense level gets +1."
register("hadrian-defense", {
  fleetDefenseModifier: 1,
});

// Doral Overseer: "All Cylon threats get +1 power."
// This is handled during Cylon phase threat reveal — passive modifier on CylonThreatCards
register("doral-overseer", {
  // Handled by computeCylonThreatModifiers dispatcher
});

// Boomer Cylon Conspirator: "Counts as 1 Civilian + 1 Cylon for missions."
register("boomer-conspirator", {
  // Handled by canResolveMission in engine
});

// ============================================================
// TRIGGERED ABILITY REGISTRATIONS
// ============================================================

// Billy Keikeya Presidential Aide: "When enters play, gain 1 influence."
register("billy-etb", {
  trigger: "onEnterPlay",
  resolve(state, playerIndex, _sid, _tid, log) {
    if (state.preventInfluenceGain) {
      log.push(`${state.preventInfluenceGain}: influence gain prevented.`);
      return;
    }
    state.players[playerIndex].influence += 1;
    log.push(
      `Billy Keikeya: ${state.playerNames[playerIndex as 0 | 1]} gains 1 influence. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// Boomer Raptor Pilot: "When enters play, draw a card."
register("boomer-etb", {
  trigger: "onEnterPlay",
  resolve(state, playerIndex, _sid, _tid, log) {
    drawCards(
      state.players[playerIndex],
      1,
      log,
      `${state.playerNames[playerIndex as 0 | 1]}`,
      state,
      playerIndex,
    );
    log.push("Boomer: Draw a card.");
  },
});

// Tom Zarek Political Prisoner: "When enters play, defeat target personnel."
register("zarek-etb", {
  trigger: "onEnterPlay",
  resolve(state, playerIndex, _sid, _targetId, log) {
    // Collect all face-up personnel on the board
    const targets: import("@bsg/shared").CardInstance[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const tc = stack.cards[0];
          if (tc?.faceUp) {
            const def = getCardDef(tc.defId);
            if (def?.type === "personnel") targets.push(tc);
          }
        }
      }
    }
    if (targets.length === 0) return;
    log.push("Tom Zarek: Choose a personnel to defeat.");
    state.pendingChoice = {
      type: "zarek-etb",
      playerIndex,
      cards: targets,
      prompt: "Tom Zarek — choose a personnel to defeat",
    };
  },
});

// Galen Tyrol Crew Chief: "When enters play, ready a ship you control."
register("tyrol-etb", {
  trigger: "onEnterPlay",
  resolve(state, playerIndex, _sid, _tid, log) {
    const player = state.players[playerIndex];
    // Collect all face-up ships in reserve
    const ships: import("@bsg/shared").CardInstance[] = [];
    for (const stack of player.zones.reserve) {
      const tc = stack.cards[0];
      if (tc?.faceUp) {
        const def = getCardDef(tc.defId);
        if (def?.type === "ship") ships.push(tc);
      }
    }
    if (ships.length === 0) return;
    // Let player choose which ship to ready
    log.push("Galen Tyrol: Choose a ship to ready.");
    state.pendingChoice = {
      type: "tyrol-etb-choice",
      playerIndex,
      cards: ships,
      prompt: "Galen Tyrol — choose a ship to ready",
    };
  },
});

// Helo Prisoner Of The Cylons: "When defeated, gain 2 influence."
register("helo-defeat", {
  trigger: "onDefeat",
  resolve(state, playerIndex, _sid, _tid, log) {
    if (state.preventInfluenceGain) {
      log.push(`${state.preventInfluenceGain}: influence gain prevented.`);
      return;
    }
    state.players[playerIndex].influence += 2;
    log.push(
      `Helo: ${state.playerNames[playerIndex as 0 | 1]} gains 2 influence on defeat. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// Mr. Gaeta Senior Officer: "Each time challenges, ready at end. Once per turn."
register("gaeta-ready", {
  trigger: "onChallengeEnd",
});

// Saul Tigh XO: "Each time challenged, ready self. At end, commit+exhaust."
register("tigh-xo", {
  trigger: "onChallengeEnd",
  isChallengePendingTrigger: true,
});

// Centurion Tracker: "Each time challenges, sacrifice at end."
register("centurion-tracker", {
  trigger: "onChallengeEnd",
});

// Helo Toaster-Lover: "Each time challenges while alert Boomer, ready at end. Once per turn."
register("helo-toaster", {
  trigger: "onChallengeEnd",
});

// Laura Roslin Leader of Prophecy: "Mystic value +1."
register("roslin-prophecy", {
  trigger: "onMysticReveal",
});

// Starbuck Risk Taker: "May commit to ignore mystic and reveal another."
register("starbuck-reroll", {
  trigger: "onMysticReveal",
});

// Galen Tyrol The Chief: "When ship enters play, may commit to ready it."
register("tyrol-chief", {
  trigger: "onShipEnterPlay",
});

// Number Six Seductress: "Vision + on undefended, may commit for +2 challenger power."
register("six-seductress", {
  trigger: "onUndefended",
});

// ============================================================
// SHIP ABILITY HANDLERS
// ============================================================

// --- Passive Power Modifiers (9 ships) ---

// Astral Queen, Prison Ship: "All defending personnel you control gain +1 power."
register("astral-queen-defend", {
  getPowerModifier(state, unitStack, ownerIndex, context) {
    if (!context.isDefender) return 0;
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (def?.type !== "personnel") return 0;
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "astral-queen-defend") return 1;
        }
      }
    }
    return 0;
  },
});

// Raptor 816: "While defending, this ship gets +1 power."
register("raptor816-defend", {
  selfOnly: true,
  getPowerModifier(_state, _unitStack, _ownerIndex, context) {
    return context.isDefender ? 1 : 0;
  },
});

// Captured Raider, Kara's Pet: "While you control an alert Starbuck, this ship gets +1 power."
register("captured-raider-starbuck", {
  selfOnly: true,
  getPowerModifier(state, _unitStack, ownerIndex) {
    return hasAlertUnitWithTitle(state.players[ownerIndex], "Starbuck") ? 1 : 0;
  },
});

// Cloud 9, Vacation Ship: "All Civilian units you control get +1 power."
register("cloud9-civilian", {
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (!unitHasTrait(state, topCard.instanceId, def, "Civilian" as Trait)) return 0;
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "cloud9-civilian") return 1;
        }
      }
    }
    return 0;
  },
});

// Colonial One, Administration HQ: "All Politicians you control get +1 power."
register("colonial-one-politician", {
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (!unitHasTrait(state, topCard.instanceId, def, "Politician" as Trait)) return 0;
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "colonial-one-politician") return 1;
        }
      }
    }
    return 0;
  },
});

// Colonial Viper 1104: "During the Cylon phase, this ship gets +2 power."
register("viper1104-cylon", {
  selfOnly: true,
  getPowerModifier(state) {
    return state.phase === "cylon" ? 2 : 0;
  },
});

// Colonial Viper 4267: "While defending, this ship gets +1 power."
register("viper4267-defend", {
  selfOnly: true,
  getPowerModifier(_state, _unitStack, _ownerIndex, context) {
    return context.isDefender ? 1 : 0;
  },
});

// Galactica, Defender of the Fleet: "All Cylon threats get -1 power."
// Handled by computeCylonThreatBonus (subtracts 1 per instance).
register("galactica-defender", {
  // Passive — implemented in computeCylonThreatBonus dispatcher
});

// Galactica, Launch Platform: "All Fighters you control get +1 power."
register("galactica-fighters", {
  getPowerModifier(state, unitStack, ownerIndex) {
    const topCard = unitStack.cards[0];
    if (!topCard) return 0;
    const def = getCardDef(topCard.defId);
    if (!unitHasTrait(state, topCard.instanceId, def, "Fighter" as Trait)) return 0;
    const owner = state.players[ownerIndex];
    for (const zone of [owner.zones.alert, owner.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "galactica-fighters") return 1;
        }
      }
    }
    return 0;
  },
});

// --- Commit Abilities (7 ships) ---

// Mining Ship: "Commit: Reveal top 2 of deck; target opponent chooses 1 for bottom, other to hand."
register("mining-ship-dig", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    const player = state.players[playerIndex];
    if (player.deck.length === 0) {
      log.push("Mining Ship: Deck empty.");
      return;
    }
    const revealed: import("@bsg/shared").CardInstance[] = [];
    for (let i = 0; i < 2 && player.deck.length > 0; i++) {
      revealed.push(player.deck.shift()!);
    }
    if (revealed.length === 1) {
      // Only 1 card — goes straight to hand
      player.hand.push(revealed[0]);
      const def = getCardDef(revealed[0].defId);
      log.push(`Mining Ship: Only 1 card in deck — ${def ? cardName(def) : "card"} goes to hand.`);
      return;
    }
    const names = revealed
      .map((c) => {
        const d = getCardDef(c.defId);
        return d ? cardName(d) : "card";
      })
      .join(", ");
    log.push(`Mining Ship: Revealed ${names}. Opponent chooses which goes to bottom.`);
    const oppIndex = 1 - playerIndex;
    state.pendingChoice = {
      type: "mining-ship-dig",
      playerIndex: oppIndex, // opponent makes the choice
      cards: revealed,
      context: { ownerIndex: playerIndex },
      prompt: "Mining Ship — choose a card to put on the bottom of opponent's deck",
    };
  },
});

// Space Park: "Commit: Look at the top card of your deck. You may put that card on the bottom."
register("space-park-scry", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    const player = state.players[playerIndex];
    if (player.deck.length === 0) {
      log.push("Space Park: Deck empty, no card to look at.");
      return;
    }
    // Remove top card from deck so it can be placed via choice
    const topCard = player.deck.shift()!;
    const def = getCardDef(topCard.defId);
    log.push(`Space Park: Looking at top card (${def ? cardName(def) : "card"}).`);
    state.pendingChoice = {
      type: "space-park-scry",
      playerIndex,
      cards: [topCard],
      prompt: "Space Park — keep on top or put on bottom of deck",
    };
  },
});

// Astral Queen, Hitch in the Plan: "Commit: Commit and exhaust target unresolved mission."
register("astral-queen-lockdown", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, _pi) {
    // Target any face-up alert mission (any player's)
    const targets: string[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const tc = stack.cards[0];
        if (tc?.faceUp) {
          const def = getCardDef(tc.defId);
          if (def?.type === "mission") targets.push(tc.instanceId);
        }
      }
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInZone(p.zones.alert, targetId);
      if (found) {
        // Commit (move to reserve) and exhaust
        p.zones.alert.splice(found.index, 1);
        found.stack.exhausted = true;
        p.zones.reserve.push(found.stack);
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Mission"} committed and exhausted.`);
        break;
      }
    }
  },
});

// Colonial One, The President's Ship: "Cannot challenge. Commit: Target player gains 1 influence."
register("colonial-one-influence", {
  canChallenge: false,
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state) {
    // Target any player (return player indices as string targets)
    // We use a convention: "player-0", "player-1" as target IDs
    const targets: string[] = [];
    for (let i = 0; i < state.players.length; i++) {
      targets.push(`player-${i}`);
    }
    return targets;
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId || !targetId.startsWith("player-")) return;
    const targetPlayerIndex = parseInt(targetId.split("-")[1], 10);
    if (isNaN(targetPlayerIndex) || !state.players[targetPlayerIndex]) return;
    if (state.preventInfluenceGain) {
      log.push(`${state.preventInfluenceGain}: influence gain prevented.`);
      return;
    }
    state.players[targetPlayerIndex].influence += 1;
    log.push(
      `${state.playerNames[targetPlayerIndex as 0 | 1]} gains 1 influence (now ${state.players[targetPlayerIndex].influence}).`,
    );
  },
});

// Colonial Viper 0205: "Commit: Target other ship gets +2 power."
register("viper0205-buff", {
  activation: { cost: "commit", usableIn: ["execution", "challenge", "cylon-challenge"] },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "ship", {
      excludeSourceId: sourceId,
    });
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    if (state.challenge) {
      applyChallengePowerBuff(state, targetId, 2, log);
    } else {
      // Outside challenge: apply power buff directly to unit stack
      for (const player of state.players) {
        for (const stack of player.zones.alert) {
          if (stack.cards[0]?.instanceId === targetId) {
            stack.powerBuff = (stack.powerBuff ?? 0) + 2;
            const def = getCardDef(stack.cards[0].defId);
            log.push(`${def ? cardName(def) : "Unit"} gets +2 power.`);
            return;
          }
        }
      }
    }
  },
});

// Gideon, Rebellious Transport: "Commit: Commit target ship."
register("gideon-commit", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, _pi, sourceId) {
    // Target any alert ship (any player's)
    const targets: string[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== sourceId) {
          const def = getCardDef(tc.defId);
          if (def?.type === "ship") targets.push(tc.instanceId);
        }
      }
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, _pi, _sid, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (findUnitInZone(p.zones.alert, targetId)) {
        commitUnit(p, targetId, log);
        break;
      }
    }
  },
});

// Raptor 659: "Commit: Target other ship gains Strafe."
register("raptor659-strafe", {
  activation: { cost: "commit", usableIn: ["execution"] },
  getTargets(state, playerIndex, sourceId) {
    return findTargetUnits(state, playerIndex, (def) => def.type === "ship", {
      ownOnly: true,
      excludeSourceId: sourceId,
    });
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    if (!player.temporaryKeywordGrants) player.temporaryKeywordGrants = {};
    const existing = player.temporaryKeywordGrants[targetId] ?? [];
    if (!existing.includes("Strafe")) existing.push("Strafe");
    player.temporaryKeywordGrants[targetId] = existing;
    const def = findDefByInstanceIdFromPlayers(state, targetId);
    log.push(`${def ? cardName(def) : "Ship"} gains Strafe.`);
  },
});

// --- Challenge-Only Commit (1 ship) ---

// Cloud 9, Transport Hub: "Commit: Commit+exhaust target defending personnel you control.
//   The challenge ends and the challenger is committed."
register("cloud9-transport", {
  activation: { cost: "commit", usableIn: ["challenge"] },
  getTargets(state, playerIndex, sourceId) {
    if (!state.challenge || !state.challenge.defenderInstanceId) return [];
    // Target own defending personnel
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (
          tc?.faceUp &&
          tc.instanceId !== sourceId &&
          tc.instanceId === state.challenge.defenderInstanceId
        ) {
          const def = getCardDef(tc.defId);
          if (def?.type === "personnel") targets.push(tc.instanceId);
        }
      }
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId || !state.challenge) return;
    // Commit+exhaust the defending personnel
    const player = state.players[playerIndex];
    commitUnit(player, targetId, log);
    const found = findUnitInAnyZone(player, targetId);
    if (found) found.stack.exhausted = true;

    // Commit the challenger
    const atkPlayer = state.players[state.challenge.challengerPlayerIndex];
    commitUnit(atkPlayer, state.challenge.challengerInstanceId, log);
    log.push("Challenge ends.");

    // End the challenge immediately
    state.challenge.forceEnd = true;
  },
});

// --- Commit+Exhaust (3 ships) ---

// Freighter: "Commit and exhaust: Put target Cylon card from your discard pile into your hand."
register("freighter-recover", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const card of player.discard) {
      const def = getCardDef(card.defId);
      if (unitHasTrait(state, card.instanceId, def, "Cylon" as Trait))
        targets.push(card.instanceId);
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const idx = player.discard.findIndex((c) => c.instanceId === targetId);
    if (idx === -1) return;
    const card = player.discard.splice(idx, 1)[0];
    player.hand.push(card);
    const def = getCardDef(card.defId);
    log.push(`${def ? cardName(def) : "Cylon card"} recovered from discard.`);
  },
});

// Astral Queen, Platform for Revolution: "Commit and exhaust: Exhaust two target personnel."
register("astral-queen-exhaust2", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets(state, _pi) {
    // Target any face-up non-exhausted personnel (any player)
    const targets: string[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const tc = stack.cards[0];
        if (tc?.faceUp && !stack.exhausted) {
          const def = getCardDef(tc.defId);
          if (def?.type === "personnel") targets.push(tc.instanceId);
        }
      }
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    // Exhaust the primary target
    for (const p of state.players) {
      const found = findUnitInZone(p.zones.alert, targetId);
      if (found && !found.stack.exhausted) {
        found.stack.exhausted = true;
        const def = getCardDef(found.stack.cards[0].defId);
        log.push(`${def ? cardName(def) : "Personnel"} exhausted.`);
        break;
      }
    }
    // Collect remaining eligible personnel for second target
    const secondTargets: import("@bsg/shared").CardInstance[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const tc = stack.cards[0];
        if (tc?.faceUp && !stack.exhausted && tc.instanceId !== targetId) {
          const def = getCardDef(tc.defId);
          if (def?.type === "personnel") secondTargets.push(tc);
        }
      }
    }
    if (secondTargets.length > 0) {
      state.pendingChoice = {
        type: "astral-queen-second",
        playerIndex,
        cards: secondTargets,
        prompt: "Astral Queen — choose a second personnel to exhaust",
      };
    }
  },
});

// Refinery Ship: "Commit and exhaust: Take an extra action. Next card cost -1 any resource."
register("refinery-extra-action", {
  activation: { cost: "commit-exhaust", usableIn: ["execution"] },
  getTargets: () => null,
  resolve(state, playerIndex, _sid, _tid, log) {
    const player = state.players[playerIndex];
    player.extraActionsRemaining = (player.extraActionsRemaining ?? 0) + 1;
    player.costReduction = { persuasion: 1, logistics: 1, security: 1 };
    log.push("Refinery Ship: Extra action granted. Next card cost reduced by 1.");
  },
});

// --- Exhaust-Only (1 ship) ---

// Doomed Liner: "Exhaust: Return target Cylon unit you control to its owner's hand."
register("doomed-liner-bounce", {
  activation: { cost: "exhaust", usableIn: ["execution"] },
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const stack of player.zones.alert) {
      const tc = stack.cards[0];
      if (tc?.faceUp) {
        const def = getCardDef(tc.defId);
        if (
          unitHasTrait(state, tc.instanceId, def, "Cylon" as Trait) &&
          (def?.type === "personnel" || def?.type === "ship")
        ) {
          targets.push(tc.instanceId);
        }
      }
    }
    for (const stack of player.zones.reserve) {
      const tc = stack.cards[0];
      if (tc?.faceUp) {
        const def = getCardDef(tc.defId);
        if (
          unitHasTrait(state, tc.instanceId, def, "Cylon" as Trait) &&
          (def?.type === "personnel" || def?.type === "ship")
        ) {
          targets.push(tc.instanceId);
        }
      }
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, playerIndex, _sid, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const found = findUnitInAnyZone(player, targetId);
    if (!found) return;
    const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
    zone.splice(found.index, 1);
    // Return top card to hand, rest to discard
    const topCard = found.stack.cards[0];
    player.hand.push(topCard);
    for (let i = 1; i < found.stack.cards.length; i++) {
      player.discard.push(found.stack.cards[i]);
    }
    const def = getCardDef(topCard.defId);
    log.push(`${def ? cardName(def) : "Cylon unit"} returned to hand.`);
  },
});

// --- Triggered: ETB (1 ship) ---

// Scouting Raider: "When this card enters play as a ship, look at the top card of target opponent's deck."
// In a 2-player game, always looks at opponent's deck. Info is private to the controller.
register("scouting-raider-etb", {
  trigger: "onEnterPlay",
  resolve(state, playerIndex, _sid, _tid, log) {
    const opponentIndex = 1 - playerIndex;
    const opponent = state.players[opponentIndex];
    if (opponent.deck.length > 0) {
      const topCard = opponent.deck[0];
      const def = getCardDef(topCard.defId);
      // Log privately — only the controlling player sees the actual card
      // In the shared log, we just note the action happened
      log.push(
        `Scouting Raider: ${state.playerNames[playerIndex as 0 | 1]} looks at top of opponent's deck.`,
      );
      // The actual card info is only useful in the log for the controlling player
      // Since we can't do private logs easily, we include it (both players see the game log)
      log.push(`  → ${def ? cardName(def) : "unknown card"}`);
    } else {
      log.push("Scouting Raider: Opponent's deck is empty.");
    }
  },
});

// --- Triggered: Challenge-End (1 ship) ---

// Skirmishing Raider: "Each time this ship challenges, sacrifice it when that challenge ends."
register("skirmishing-raider-sacrifice", {
  trigger: "onChallengeEnd",
});

// --- Triggered: Challenge-Init (1 ship) ---

// Colonial Viper 762: "Each time this ship challenges, may commit target Pilot for +3 power."
register("viper762-pilot", {
  trigger: "onChallengeInit",
});

// --- Triggered: Challenge-Win (1 ship) ---

// Nuclear-Armed Raider: "Each time this ship wins a challenge, defeat target asset with no supply cards."
register("nuclear-raider-win", {
  trigger: "onChallengeWin",
});

// --- Reactive triggers (handled via inline hooks, not registry activation) ---

// Cloud 9, Cruise Ship: "Each time you lose influence, may commit to reduce by 1."
// Logic in interceptCloud9Loss() above + game-engine.ts interceptCloud9() + base-abilities.ts
register("cloud9-shield", { interceptInfluenceLoss: true });

// Ordnance Freighter: "Each time you spend a resource stack, may commit. Generate [security]."
// Logic in game-engine.ts payResourceCost/spendAnyResources + FREIGHTER_RESOURCE map
register("ordnance-freighter", { freighterResource: "security" });

// Supply Freighter: "Each time you spend a resource stack, may commit. Generate [logistics]."
// Logic in game-engine.ts payResourceCost/spendAnyResources + FREIGHTER_RESOURCE map
register("supply-freighter", { freighterResource: "logistics" });

// Troop Freighter: "Each time you spend a resource stack, may commit. Generate [persuasion]."
// Logic in game-engine.ts payResourceCost/spendAnyResources + FREIGHTER_RESOURCE map
register("troop-freighter", { freighterResource: "persuasion" });

// Olympic Carrier: "When resolving Cylon mission, sacrifice for 2 requirements."
// Logic in game-engine.ts canResolveMission + resolveMission handler
register("olympic-carrier-mission", {});

// Raptor 432: "Flash play from hand when challenged by ship to defend."
// Logic in game-engine.ts getValidActions (defender selection) + defend case handler
register("raptor432-flash", { canFlashPlayToDefend: true });

// ============================================================
// DISPATCHERS
// ============================================================

/** Get valid actions for an activated unit ability. */
export function getUnitAbilityActions(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  sourceInstanceId: string,
  context: "execution" | "challenge" | "cylon-challenge",
): ValidAction[] {
  const handler = registry.get(abilityId);
  if (!handler?.activation) return [];
  if (!handler.activation.usableIn.includes(context)) return [];

  // Once-per-turn check
  if (handler.activation.oncePerTurn) {
    const used = state.players[playerIndex].oncePerTurnUsed;
    if (used?.[abilityId]) return [];
  }

  const sourceDef = findDefByInstanceIdFromPlayers(state, sourceInstanceId);
  if (!sourceDef) return [];

  let targets = handler.getTargets?.(state, playerIndex, sourceInstanceId) ?? null;

  // Filter out units with "all" effect immunity (Fallout Shelter)
  if (targets && state.effectImmunity) {
    targets = targets.filter((id) => state.effectImmunity?.[id] !== "all");
  }

  if (targets === null) {
    // No target needed
    return [
      {
        type: "playAbility",
        description: `${cardName(sourceDef)}: ${sourceDef.abilityText.split("\n").pop()!.split(".")[0]}`,
        cardDefId: sourceDef.id,
        selectableInstanceIds: [sourceInstanceId],
      },
    ];
  }

  if (targets.length === 0) return [];

  const actions: ValidAction[] = [];
  for (const targetId of targets) {
    const targetDef = findDefByInstanceIdFromPlayers(state, targetId);
    const ownerIdx = findOwnerIndexFromPlayers(state, targetId);
    const ownerTag = ownerIdx !== null && ownerIdx !== playerIndex ? "(opponent's) " : "";
    const targetLabel = targetDef ? cardName(targetDef) : targetId;
    actions.push({
      type: "playAbility",
      description: `${cardName(sourceDef)}: → ${ownerTag}${targetLabel}`,
      cardDefId: sourceDef.id,
      selectableInstanceIds: [sourceInstanceId],
      targetInstanceId: targetId,
    });
  }
  return actions;
}

/** Resolve a unit ability effect (cost already paid by engine). */
export function resolveUnitAbility(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  sourceInstanceId: string,
  targetInstanceId: string | undefined,
  log: LogItem[],
): void {
  const handler = registry.get(abilityId);
  if (!handler) {
    log.push(`Unit ability ${abilityId} not found in registry.`);
    return;
  }

  // Track once-per-turn usage
  if (handler.activation?.oncePerTurn) {
    if (!state.players[playerIndex].oncePerTurnUsed) {
      state.players[playerIndex].oncePerTurnUsed = {};
    }
    state.players[playerIndex].oncePerTurnUsed![abilityId] = true;
  }

  handler.resolve?.(state, playerIndex, sourceInstanceId, targetInstanceId, log);
}

/** Get the activation cost type for a unit ability. */
export function getUnitAbilityCost(
  abilityId: string,
):
  | "commit"
  | "commit-exhaust"
  | "commit-sacrifice"
  | "commit-other"
  | "sacrifice-other"
  | "exhaust"
  | null {
  return registry.get(abilityId)?.activation?.cost ?? null;
}

/** Check if a unit ability prevents challenging. */
export function canUnitAbilityChallenge(abilityId: string): boolean {
  const handler = registry.get(abilityId);
  if (handler?.canChallenge === false) return false;
  return true;
}

/** Compute total passive power modifier for a unit. */
export function computePassivePowerModifier(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
  context: PowerContext,
): number {
  let total = 0;
  const topCard = unitStack.cards[0];
  if (!topCard) return 0;

  const unitDef = getCardDef(topCard.defId);
  if (!unitDef) return 0;

  // Check this unit's own abilityId for self-modifying passives
  if (unitDef.abilityId) {
    const handler = registry.get(unitDef.abilityId);
    if (handler?.getPowerModifier) {
      total += handler.getPowerModifier(state, unitStack, ownerIndex, context);
    }
  }

  // Check ALL other units in play for "all X get +Y" passives
  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const player = state.players[pIdx];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (!tc?.faceUp || tc.instanceId === topCard.instanceId) continue;
        const tcDef = getCardDef(tc.defId);
        if (!tcDef?.abilityId) continue;

        // Only check passives that affect OTHER units (skip selfOnly modifiers)
        const handler = registry.get(tcDef.abilityId);
        if (!handler?.getPowerModifier || handler.selfOnly) continue;

        // These handlers return 0 if the unit doesn't match their criteria
        const mod = handler.getPowerModifier(state, unitStack, ownerIndex, context);
        if (mod !== 0) total += mod;
      }
    }
  }

  return total;
}

/** Itemized passive power modifiers for a unit (for log breakdown). */
export function computePassivePowerBreakdown(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
  context: PowerContext,
): { source: string; amount: number }[] {
  const items: { source: string; amount: number }[] = [];
  const topCard = unitStack.cards[0];
  if (!topCard) return items;

  const unitDef = getCardDef(topCard.defId);
  if (!unitDef) return items;

  // Self-modifying passives
  if (unitDef.abilityId) {
    const handler = registry.get(unitDef.abilityId);
    if (handler?.getPowerModifier) {
      const mod = handler.getPowerModifier(state, unitStack, ownerIndex, context);
      if (mod !== 0) items.push({ source: cardName(unitDef), amount: mod });
    }
  }

  // Aura passives from other units
  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const player = state.players[pIdx];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (!tc?.faceUp || tc.instanceId === topCard.instanceId) continue;
        const tcDef = getCardDef(tc.defId);
        if (!tcDef?.abilityId) continue;
        const handler = registry.get(tcDef.abilityId);
        if (!handler?.getPowerModifier || handler.selfOnly) continue;
        const mod = handler.getPowerModifier(state, unitStack, ownerIndex, context);
        if (mod !== 0) items.push({ source: cardName(tcDef), amount: mod });
      }
    }
  }

  return items;
}

/** Compute fleet defense modifiers from all units in play. */
export function computeFleetDefenseModifiers(state: GameState): number {
  let total = 0;
  for (const player of state.players) {
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard?.faceUp) {
        const def = getCardDef(topCard.defId);
        if (def?.abilityId) {
          const handler = registry.get(def.abilityId);
          if (handler?.fleetDefenseModifier) {
            total += handler.fleetDefenseModifier;
          }
        }
      }
    }
  }
  return total;
}

/** Count Doral Overseer bonus for Cylon threat cards. */
export function computeCylonThreatBonus(state: GameState): number {
  let bonus = 0;
  for (const player of state.players) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const topCard = stack.cards[0];
        if (topCard?.faceUp) {
          const def = getCardDef(topCard.defId);
          if (def?.abilityId === "doral-overseer") bonus += 1;
          if (def?.abilityId === "galactica-defender") bonus -= 1;
        }
      }
    }
  }
  return bonus;
}

/** Fire onEnterPlay triggers for a card that just entered play. */
export function fireOnEnterPlay(
  state: GameState,
  playerIndex: number,
  def: CardDef,
  instanceId: string,
  log: LogItem[],
): void {
  if (!def.abilityId) return;
  const handler = registry.get(def.abilityId);
  if (handler?.trigger !== "onEnterPlay") return;
  handler.resolve?.(state, playerIndex, instanceId, undefined, log);
}

/** Fire onDefeat triggers for a card about to be defeated. */
export function fireOnDefeat(
  state: GameState,
  playerIndex: number,
  def: CardDef,
  instanceId: string,
  log: LogItem[],
): void {
  if (!def.abilityId) return;
  const handler = registry.get(def.abilityId);
  if (handler?.trigger !== "onDefeat") return;
  handler.resolve?.(state, playerIndex, instanceId, undefined, log);
}

/** Fire onChallengeEnd triggers.
 *  Mandatory triggers (sacrifice) fire immediately.
 *  Optional triggers (Gaeta/Helo ready) set pendingChoice for player decision.
 *  Tigh XO commit+exhaust is handled in resolveChallenge cleanup. */
export function fireOnChallengeEnd(
  state: GameState,
  challenge: ChallengeState,
  log: LogItem[],
): void {
  // Check challenger for challenge-end triggers
  const attackerPlayer = state.players[challenge.challengerPlayerIndex];
  const challengerFound = findUnitInAnyZone(attackerPlayer, challenge.challengerInstanceId);
  if (challengerFound) {
    const cDef = getCardDef(challengerFound.stack.cards[0].defId);
    if (cDef?.abilityId) {
      const handler = registry.get(cDef.abilityId);
      if (handler?.trigger === "onChallengeEnd") {
        // Mandatory: Centurion Tracker — sacrifice self after challenging
        if (cDef.abilityId === "centurion-tracker") {
          defeatUnitLocal(attackerPlayer, challenge.challengerInstanceId, log);
          log.push("Centurion Tracker is sacrificed after challenging.");
        }
        // Mandatory: Skirmishing Raider — sacrifice self when challenge ends
        if (cDef.abilityId === "skirmishing-raider-sacrifice") {
          defeatUnitLocal(attackerPlayer, challenge.challengerInstanceId, log);
          log.push("Skirmishing Raider is sacrificed after challenging.");
        }
        // Optional: Gaeta Senior Officer — "you may ready it" (once per turn)
        if (cDef.abilityId === "gaeta-ready" && challengerFound.zone === "reserve") {
          const used = attackerPlayer.oncePerTurnUsed?.[cDef.abilityId];
          if (!used) {
            state.pendingChoice = {
              type: "gaeta-ready-choice",
              playerIndex: challenge.challengerPlayerIndex,
              cards: [],
              context: { unitId: challenge.challengerInstanceId },
              prompt: "Gaeta — ready this unit after challenging?",
            };
            return; // wait for player choice
          }
        }
        // Optional: Helo Toaster-Lover — "you can ready" if alert Boomer (once per turn)
        if (
          cDef.abilityId === "helo-toaster" &&
          challengerFound.zone === "reserve" &&
          hasAlertUnitWithTitle(attackerPlayer, "Boomer")
        ) {
          const used = attackerPlayer.oncePerTurnUsed?.[cDef.abilityId];
          if (!used) {
            state.pendingChoice = {
              type: "helo-toaster-choice",
              playerIndex: challenge.challengerPlayerIndex,
              cards: [],
              context: { unitId: challenge.challengerInstanceId },
              prompt: "Helo — ready this unit after challenging?",
            };
            return; // wait for player choice
          }
        }
      }
    }
  }
}

/** Fire onMysticReveal — returns adjusted mystic value. */
export function fireOnMysticReveal(state: GameState, playerIndex: number, value: number): number {
  let adjusted = value;
  const player = state.players[playerIndex];

  // Laura Roslin Leader of Prophecy: +1 to all mystic values
  for (const zone of [player.zones.alert, player.zones.reserve]) {
    for (const stack of zone) {
      const tc = stack.cards[0];
      if (tc?.faceUp) {
        const def = getCardDef(tc.defId);
        if (def?.abilityId === "roslin-prophecy") {
          adjusted += 1;
        }
      }
    }
  }

  return adjusted;
}

/** Fire onShipEnterPlay — for Galen Tyrol The Chief (optional). */
export function fireOnShipEnterPlay(
  state: GameState,
  playerIndex: number,
  shipInstanceId: string,
  log: LogItem[],
): void {
  const player = state.players[playerIndex];
  for (const stack of player.zones.alert) {
    const tc = stack.cards[0];
    if (tc?.faceUp && !stack.exhausted) {
      const def = getCardDef(tc.defId);
      if (def?.abilityId === "tyrol-chief") {
        // Offer player the choice to commit Tyrol to ready the ship
        log.push("Galen Tyrol: You may commit to ready the entering ship.");
        state.pendingChoice = {
          type: "tyrol-chief-choice",
          playerIndex,
          cards: [],
          context: { tyrolInstanceId: tc.instanceId, shipInstanceId },
          prompt: "Galen Tyrol — commit to ready the entering ship?",
        };
        return;
      }
    }
  }
}

/** Fire onChallengeInit — for triggered abilities that fire when a unit challenges. */
export function fireOnChallengeInit(
  state: GameState,
  playerIndex: number,
  challengerInstanceId: string,
  log: LogItem[],
): void {
  const player = state.players[playerIndex];
  // Check the challenger itself for onChallengeInit triggers
  const challengerFound = findUnitInAnyZone(player, challengerInstanceId);
  if (!challengerFound) return;
  const challengerDef = getCardDef(challengerFound.stack.cards[0].defId);
  if (!challengerDef?.abilityId) return;

  const handler = registry.get(challengerDef.abilityId);
  if (handler?.trigger !== "onChallengeInit") return;

  // Viper 762: may commit target Pilot for +3 power
  if (challengerDef.abilityId === "viper762-pilot") {
    // Find first alert Pilot to commit
    for (const stack of player.zones.alert) {
      const tc = stack.cards[0];
      if (tc?.faceUp && tc.instanceId !== challengerInstanceId) {
        const def = getCardDef(tc.defId);
        if (
          def?.type === "personnel" &&
          unitHasTrait(state, tc.instanceId, def, "Pilot" as Trait)
        ) {
          commitUnit(player, tc.instanceId, log);
          if (state.challenge) {
            state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + 3;
          }
          log.push(`Viper 762 gets +3 power.`);
          return;
        }
      }
    }
  }
}

/** Fire onChallengeWin — for triggered abilities that fire when a unit wins a challenge. */
export function fireOnChallengeWin(
  state: GameState,
  winnerPlayerIndex: number,
  winnerInstanceId: string,
  log: LogItem[],
): void {
  const player = state.players[winnerPlayerIndex];
  const winnerFound = findUnitInAnyZone(player, winnerInstanceId);
  if (!winnerFound) return;
  const winnerDef = getCardDef(winnerFound.stack.cards[0].defId);
  if (!winnerDef?.abilityId) return;

  const handler = registry.get(winnerDef.abilityId);
  if (handler?.trigger !== "onChallengeWin") return;

  // Nuclear-Armed Raider: defeat target asset with no supply cards
  if (winnerDef.abilityId === "nuclear-raider-win") {
    // Find first opponent asset with no supply cards
    const opponentIndex = 1 - winnerPlayerIndex;
    const opponent = state.players[opponentIndex];
    for (let i = 1; i < opponent.zones.resourceStacks.length; i++) {
      const rStack = opponent.zones.resourceStacks[i];
      if (rStack.supplyCards.length === 0 && !rStack.exhausted) {
        // Defeat (remove) the asset
        const assetCard = rStack.topCard;
        opponent.discard.push(assetCard);
        opponent.zones.resourceStacks.splice(i, 1);
        const def = getCardDef(assetCard.defId);
        log.push(
          `Nuclear-Armed Raider defeats ${def ? cardName(def) : "asset"} (no supply cards).`,
        );
        return;
      }
    }
  }
}

/** Get effective traits for a unit (base traits + temporary grants). */
export function getEffectiveTraits(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
): Trait[] {
  const topCard = unitStack.cards[0];
  if (!topCard) return [];
  const def = getCardDef(topCard.defId);
  if (!def) return [];

  const traits: Trait[] = [...(def.traits ?? [])];
  const player = state.players[ownerIndex];

  // Temporary trait grants
  const grants = player.temporaryTraitGrants?.[topCard.instanceId];
  if (grants) {
    for (const t of grants) {
      if (!traits.includes(t)) traits.push(t);
    }
  }

  // Apollo Political Liaison: all other Officers gain Politician
  if (
    unitHasTrait(state, topCard.instanceId, def, "Officer" as Trait) &&
    !traits.includes("Politician")
  ) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const tc = stack.cards[0];
        if (tc?.faceUp && tc.instanceId !== topCard.instanceId) {
          const tcDef = getCardDef(tc.defId);
          if (tcDef?.abilityId === "apollo-politician") {
            traits.push("Politician");
            break;
          }
        }
      }
    }
  }

  return traits;
}

/** Get effective keywords for a unit (base keywords + temporary grants). */
export function getEffectiveKeywords(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
): Keyword[] {
  const topCard = unitStack.cards[0];
  if (!topCard) return [];
  const def = getCardDef(topCard.defId);
  if (!def) return [];

  const keywords: Keyword[] = [...(def.keywords ?? [])];
  const player = state.players[ownerIndex];

  const grants = player.temporaryKeywordGrants?.[topCard.instanceId];
  if (grants) {
    for (const k of grants) {
      if (!keywords.includes(k)) keywords.push(k);
    }
  }

  return keywords;
}

// --- Exported helpers for game-engine re-entrant challenge flow ---

/** Find an alert, face-up, non-exhausted Starbuck Risk Taker for the given player. */
export function findAlertStarbuckReroll(
  player: PlayerState,
): import("@bsg/shared").CardInstance | null {
  for (const stack of player.zones.alert) {
    const tc = stack.cards[0];
    if (tc?.faceUp && !stack.exhausted) {
      const def = getCardDef(tc.defId);
      if (def?.abilityId === "starbuck-reroll") return tc;
    }
  }
  return null;
}

/** Find an alert, face-up, non-exhausted Number Six Seductress for the given player. */
export function findAlertSixSeductress(
  player: PlayerState,
): import("@bsg/shared").CardInstance | null {
  for (const stack of player.zones.alert) {
    const tc = stack.cards[0];
    if (tc?.faceUp && !stack.exhausted) {
      const def = getCardDef(tc.defId);
      if (def?.abilityId === "six-seductress") return tc;
    }
  }
  return null;
}

/** Find a reserve, face-up, non-exhausted Saul Tigh XO for the given player. */
export function findReserveTighXO(player: PlayerState): import("@bsg/shared").CardInstance | null {
  for (const stack of player.zones.reserve) {
    const tc = stack.cards[0];
    if (tc?.faceUp && !stack.exhausted) {
      const def = getCardDef(tc.defId);
      if (def?.abilityId === "tigh-xo") return tc;
    }
  }
  return null;
}

// --- Internal helpers ---

function findDefByInstanceId(state: GameState, instanceId: string): CardDef | null {
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

function findDefByInstanceIdFromPlayers(state: GameState, instanceId: string): CardDef | null {
  return findDefByInstanceId(state, instanceId);
}

function findOwnerIndexFromPlayers(state: GameState, instanceId: string): number | null {
  const idx = state.players.findIndex((p) =>
    [...p.zones.alert, ...p.zones.reserve].some((stack) =>
      stack.cards.some((c) => c.instanceId === instanceId),
    ),
  );
  return idx === -1 ? null : idx;
}

function applyChallengePowerBuff(
  state: GameState,
  instanceId: string,
  amount: number,
  log: LogItem[],
): void {
  if (!state.challenge) return;
  if (instanceId === state.challenge.challengerInstanceId) {
    state.challenge.challengerPowerBuff = (state.challenge.challengerPowerBuff ?? 0) + amount;
    log.push(`Challenger gets ${amount > 0 ? "+" : ""}${amount} power.`);
  } else if (instanceId === state.challenge.defenderInstanceId) {
    state.challenge.defenderPowerBuff = (state.challenge.defenderPowerBuff ?? 0) + amount;
    log.push(`Defender gets ${amount > 0 ? "+" : ""}${amount} power.`);
  }
}

// ============================================================
// DIP Dispatchers (Phase 3 hooks)
// ============================================================

/** Get the freighter resource type for a given abilityId, or undefined if not a freighter. */
export function getFreighterResource(
  abilityId: string,
): "security" | "logistics" | "persuasion" | undefined {
  return registry.get(abilityId)?.freighterResource;
}

/** Get the commit-other power buff amount for a unit ability (default 1). */
export function getCommitOtherPowerBuff(abilityId: string): number {
  return registry.get(abilityId)?.commitOtherPowerBuff ?? 1;
}

/** Check if a unit ability can be flash-played from hand to defend. */
export function canFlashDefend(abilityId: string): boolean {
  return registry.get(abilityId)?.canFlashPlayToDefend ?? false;
}

/** Check if a unit's trigger should be treated as a challenge pending trigger (not a base trigger). */
export function isChallengePendingTriggerAbility(abilityId: string): boolean {
  return registry.get(abilityId)?.isChallengePendingTrigger ?? false;
}

/** Check if a unit ability can intercept influence loss. */
export function canInterceptInfluenceLoss(abilityId: string): boolean {
  return registry.get(abilityId)?.interceptInfluenceLoss ?? false;
}

// ============================================================
// Pending Choice Handlers
// ============================================================

registerPendingChoice("space-park-scry", {
  getActions(choice) {
    const def = getCardDef(choice.cards[0].defId);
    if (!def) return [];
    return [
      { type: "makeChoice", description: `Keep ${cardName(def)} on top`, cardDefId: def.id },
      { type: "makeChoice", description: `Put ${cardName(def)} on bottom`, cardDefId: def.id },
    ];
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const card = choice.cards[0];
    if (!card) return;
    const def = getCardDef(card.defId);
    if (choiceIndex === 0) {
      player.deck.unshift(card);
      if (def) log.push(`Space Park: Kept ${cardName(def)} on top.`);
    } else {
      player.deck.push(card);
      if (def) log.push(`Space Park: Put ${cardName(def)} on bottom.`);
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestMystic = -1;
    for (const action of choiceActions) {
      if (action.cardDefId) {
        const def = getCardDef(action.cardDefId);
        bestMystic = Math.max(bestMystic, def?.mysticValue ?? 0);
      }
    }
    return bestMystic < 2 ? 1 : 0;
  },
});

registerPendingChoice("mining-ship-dig", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Send ${cardName(def)} to bottom`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const ownerIdx = ctx.ownerIndex as number;
    const owner = state.players[ownerIdx];
    const bottomCard = choice.cards[choiceIndex];
    const handCard = choice.cards[1 - choiceIndex];
    if (bottomCard && handCard) {
      owner.deck.push(bottomCard);
      owner.hand.push(handCard);
      const bDef = getCardDef(bottomCard.defId);
      const hDef = getCardDef(handCard.defId);
      if (bDef && hDef) {
        log.push(`Mining Ship: ${cardName(bDef)} goes to bottom, ${cardName(hDef)} goes to hand.`);
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let worstIdx = 0;
    let worstPow = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const pow = def?.power ?? 0;
        if (pow > worstPow) {
          worstPow = pow;
          worstIdx = i;
        }
      }
    }
    return worstIdx;
  },
});

registerPendingChoice("boomer-search", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Take ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "Take nothing" });
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    if (choiceIndex >= choice.cards.length) {
      log.push("Boomer: Chose not to take a personnel.");
      for (let j = player.deck.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
      }
    } else {
      const card = choice.cards[choiceIndex];
      const def = getCardDef(card.defId);
      const deckIdx = player.deck.findIndex((c) => c.instanceId === card.instanceId);
      if (deckIdx >= 0) player.deck.splice(deckIdx, 1);
      player.hand.push(card);
      if (def) log.push(`Boomer: Searched deck and found ${cardName(def)}.`);
      for (let j = player.deck.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const pow = def?.power ?? 0;
        if (pow > bestPow) {
          bestPow = pow;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("zarek-etb", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Defeat ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const h = getHelpers();
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      if (findUnitInAnyZone(p, chosenCard.instanceId)) {
        h.defeatUnit(p, chosenCard.instanceId, log, state, pi);
        log.push("Tom Zarek: Defeats a personnel on entering play.");
        break;
      }
    }
  },
  aiDecide(choice, choiceActions, state, playerIndex) {
    const oppIdx = 1 - playerIndex;
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const pow = def?.power ?? 0;
        const card = choice.cards[i];
        const isOpp = card && !!findUnitInAnyZone(state.players[oppIdx], card.instanceId);
        const score = pow + (isOpp ? 100 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("astral-queen-second", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Exhaust ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, chosenCard.instanceId);
      if (found) {
        found.stack.exhausted = true;
        const def = getCardDef(found.stack.cards[0].defId);
        if (def) log.push(`Astral Queen: ${cardName(def)} also exhausted.`);
        break;
      }
    }
  },
  aiDecide(choice, choiceActions, state, playerIndex) {
    const oppIdx = 1 - playerIndex;
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const card = choice.cards[i];
      const isOpp = card && !!findUnitInAnyZone(state.players[oppIdx], card.instanceId);
      const defId = choiceActions[i].cardDefId;
      const def = defId ? getCardDef(defId) : undefined;
      const score = (def?.power ?? 0) + (isOpp ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("tyrol-etb-choice", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Ready ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (chosenCard) {
      readyUnit(player, chosenCard.instanceId, log);
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("tyrol-chief-choice", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Commit Tyrol to ready ship" },
      { type: "makeChoice" as const, description: "Decline" },
    ];
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const tyrolId = ctx.tyrolInstanceId as string;
    const shipId = ctx.shipInstanceId as string;
    if (choiceIndex === 0) {
      commitUnit(player, tyrolId, log);
      readyUnit(player, shipId, log);
    } else {
      log.push("Galen Tyrol declines to ready entering ship.");
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("six-seductress", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Commit Six — challenger gets +2 power" },
      { type: "makeChoice" as const, description: "Decline" },
    ];
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    if (choiceIndex === 0 && state.challenge) {
      const sixId = ctx.sixInstanceId as string;
      commitUnit(player, sixId, log);
      state.challenge.sixSeductressBuff = 2;
      log.push("Number Six Seductress — challenger gets +2 power.");
    } else {
      log.push("Number Six Seductress: declined.");
    }
    if (state.challenge) {
      const h = getHelpers();
      h.resumeChallenge(state, log, h.bases);
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("manipulate-choice", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Manipulate — gain influence" },
      { type: "makeChoice" as const, description: "Normal — opponent loses influence" },
    ];
  },
  resolve(_choice, choiceIndex, state, _player, _playerIndex, log) {
    if (state.challenge) {
      if (choiceIndex === 0) {
        state.challenge.manipulateChosen = true;
        log.push("Manipulate chosen — challenger will gain influence.");
      } else {
        state.challenge.manipulateChosen = false;
        log.push("Manipulate declined — opponent will lose influence.");
      }
      const h = getHelpers();
      h.resumeChallenge(state, log, h.bases);
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("starbuck-reroll", {
  getActions(choice) {
    const currentVal =
      (((choice.context ?? {}) as Record<string, unknown>).currentValue as number) ?? 0;
    return [
      {
        type: "makeChoice" as const,
        description: `Commit Starbuck — reroll (current: ${currentVal})`,
      },
      { type: "makeChoice" as const, description: `Keep mystic value (${currentVal})` },
    ];
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const side = ctx.side as string;
    if (choiceIndex === 0 && state.challenge) {
      const starbuckCard = choice.cards[0];
      if (starbuckCard) {
        commitUnit(player, starbuckCard.instanceId, log);
        log.push("Starbuck — ignoring mystic value, revealing another.");
        if (side === "challenger") {
          state.challenge.challengerMysticValue = null;
        } else {
          state.challenge.defenderMysticValue = null;
        }
      }
    } else {
      log.push("Starbuck: keeping current mystic value.");
    }
    if (state.challenge) {
      const h = getHelpers();
      h.resumeChallenge(state, log, h.bases);
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("gaeta-ready-choice", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Ready Mr. Gaeta" },
      { type: "makeChoice" as const, description: "Decline" },
    ];
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const unitId = ctx.unitId as string;
    if (choiceIndex === 0) {
      readyUnit(player, unitId, log);
      if (!player.oncePerTurnUsed) player.oncePerTurnUsed = {};
      player.oncePerTurnUsed["gaeta-ready"] = true;
    } else {
      log.push("Mr. Gaeta declines to ready.");
    }
    if (state.challenge) {
      const h = getHelpers();
      h.resumeChallenge(state, log, h.bases);
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("helo-toaster-choice", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Ready Helo" },
      { type: "makeChoice" as const, description: "Decline" },
    ];
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const unitId = ctx.unitId as string;
    if (choiceIndex === 0) {
      readyUnit(player, unitId, log);
      if (!player.oncePerTurnUsed) player.oncePerTurnUsed = {};
      player.oncePerTurnUsed["helo-toaster"] = true;
    } else {
      log.push("Helo declines to ready.");
    }
    if (state.challenge) {
      const h = getHelpers();
      h.resumeChallenge(state, log, h.bases);
    }
  },
  aiDecide() {
    return 0;
  },
});
