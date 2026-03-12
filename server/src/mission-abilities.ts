// ============================================================
// Mission Abilities Registry (Open/Closed Principle)
// ============================================================
// Each mission card's effects are registered here by abilityId.
// Game engine calls dispatchers; adding new missions requires
// only a new register() call — no engine changes needed.
//
// Three categories:
//   one-shot  — resolve effect fires once, mission discards
//   persistent — resolve effect fires, mission stays in play
//   link       — mission attaches to a unit on resolve
// ============================================================

import type {
  GameState,
  PlayerState,
  CardDef,
  BaseCardDef,
  UnitStack,
  CardInstance,
  Keyword,
  ValidAction,
  LogItem,
  Trait,
} from "@bsg/shared";
import { registerPendingChoice } from "./pending-choice-registry.js";

// Re-use PowerContext from unit-abilities
export interface PowerContext {
  phase?: string;
  isChallenger?: boolean;
  isDefender?: boolean;
  challengerDef?: CardDef;
}

// ============================================================
// Handler Interface
// ============================================================

export interface MissionAbilityHandler {
  category: "one-shot" | "persistent" | "link";

  /** For Link: what unit type can be targeted for attachment */
  linkTarget?: "personnel" | "ship" | "unit";

  // --- Resolve-time ---
  canResolve?(state: GameState, playerIndex: number): boolean;
  getResolveTargets?(state: GameState, playerIndex: number): string[] | null;
  onResolve?(
    state: GameState,
    playerIndex: number,
    targetId: string | undefined,
    log: LogItem[],
  ): void;

  // --- Ongoing passive modifiers (persistent + link) ---
  getPowerModifier?(
    state: GameState,
    unitStack: UnitStack,
    ownerIndex: number,
    context: PowerContext,
  ): number;
  fleetDefenseModifier?: number;
  cylonThreatBonus?: number;
  getKeywordGrants?(state: GameState, unitStack: UnitStack, ownerIndex: number): Keyword[];
  canChallenge?: false;

  // --- Activated abilities (persistent or link) ---
  activation?: {
    cost:
      | "commit-unit"
      | "commit-exhaust-unit"
      | "exhaust-mission"
      | "sacrifice-mission"
      | "commit-exhaust-politician";
    usableIn: ("execution" | "challenge" | "cylon-challenge")[];
    oncePerTurn?: boolean;
    getTargets?(state: GameState, playerIndex: number, sourceId: string): string[] | null;
    resolve(
      state: GameState,
      playerIndex: number,
      sourceId: string,
      targetId: string | undefined,
      log: LogItem[],
    ): void;
  };

  // --- Trigger hooks ---
  onEventPlay?(state: GameState, playerIndex: number, log: LogItem[]): void;
  onReadyPhaseStart?(state: GameState, playerIndex: number, log: LogItem[]): void;
  onMysticReveal?(state: GameState, playerIndex: number, value: number, cardDef: CardDef): number;
  interceptDefeat?(
    state: GameState,
    playerIndex: number,
    unitType: "personnel" | "ship",
    unitInstanceId: string,
    log: LogItem[],
  ): boolean;
  onLinkedUnitLeavePlay?(
    state: GameState,
    playerIndex: number,
    unitInstanceId: string,
    log: LogItem[],
  ): void;
  onCylonThreatDefeat?(
    state: GameState,
    playerIndex: number,
    unitInstanceId: string,
    log: LogItem[],
  ): void;
  onChallengeWin?(
    state: GameState,
    playerIndex: number,
    winnerStack: UnitStack,
    loserStack: UnitStack,
    powerDiff: number,
    log: LogItem[],
    isDefender: boolean,
  ): void;
  onDraw?(state: GameState, playerIndex: number, drawCount: number, log: LogItem[]): void;

  // --- Special game rule modifiers ---
  preventOverlay?(state: GameState, playerIndex: number, unitDef: CardDef): boolean;
  challengeCostModifier?(state: GameState, challengerIndex: number, defenderIndex: number): number;
}

// ============================================================
// Game Engine Helpers (injected to avoid circular imports)
// ============================================================

export interface MissionGameHelpers {
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
  bases: Record<string, BaseCardDef>;
}

let helpers: MissionGameHelpers;

export function setMissionGameHelpers(h: MissionGameHelpers): void {
  helpers = h;
}

// ============================================================
// Card Registry (injected from game engine)
// ============================================================

let cardRegistry: Record<string, CardDef> = {};

export function setMissionAbilityCardRegistry(cards: Record<string, CardDef>): void {
  cardRegistry = cards;
}

// ============================================================
// Registry
// ============================================================

const registry = new Map<string, MissionAbilityHandler>();

function register(abilityId: string, handler: MissionAbilityHandler): void {
  registry.set(abilityId, handler);
}

// ============================================================
// Local Helpers
// ============================================================

function getCardDef(defId: string): CardDef {
  return cardRegistry[defId];
}

function findUnitInZone(
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

function findUnitInAnyZone(
  player: PlayerState,
  instanceId: string,
): { stack: UnitStack; zone: "alert" | "reserve"; index: number } | null {
  const alertResult = findUnitInZone(player.zones.alert, instanceId);
  if (alertResult) return { ...alertResult, zone: "alert" };
  const reserveResult = findUnitInZone(player.zones.reserve, instanceId);
  if (reserveResult) return { ...reserveResult, zone: "reserve" };
  return null;
}

function findUnitOwner(
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

function commitUnitLocal(player: PlayerState, instanceId: string, log?: LogItem[]): boolean {
  const found = findUnitInZone(player.zones.alert, instanceId);
  if (found) {
    player.zones.alert.splice(found.index, 1);
    player.zones.reserve.push(found.stack);
    if (log) {
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? helpers.cardName(def) : "Unit"} committed.`);
    }
    return true;
  }
  return false;
}

function readyUnitLocal(player: PlayerState, instanceId: string, log?: LogItem[]): boolean {
  const found = findUnitInZone(player.zones.reserve, instanceId);
  if (found && !found.stack.exhausted) {
    player.zones.reserve.splice(found.index, 1);
    player.zones.alert.push(found.stack);
    if (log) {
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? helpers.cardName(def) : "Unit"} readied.`);
    }
    return true;
  }
  return false;
}

function exhaustUnitLocal(_player: PlayerState, stack: UnitStack): boolean {
  if (!stack.exhausted) {
    stack.exhausted = true;
    return true;
  }
  return false;
}

/** Get all face-up alert units for a player */
function getAlertUnits(
  player: PlayerState,
): { stack: UnitStack; def: CardDef; instanceId: string }[] {
  const results: { stack: UnitStack; def: CardDef; instanceId: string }[] = [];
  for (const stack of player.zones.alert) {
    const top = stack.cards[0];
    if (top?.faceUp) {
      const def = getCardDef(top.defId);
      if (def && (def.type === "personnel" || def.type === "ship")) {
        results.push({ stack, def, instanceId: top.instanceId });
      }
    }
  }
  return results;
}

/** Remove a unit from play entirely, returning the stack if found */
function removeUnitFromPlay(
  player: PlayerState,
  instanceId: string,
): { stack: UnitStack; zone: "alert" | "reserve" } | null {
  const result = findUnitInAnyZone(player, instanceId);
  if (!result) return null;
  const zone = result.zone === "alert" ? player.zones.alert : player.zones.reserve;
  zone.splice(result.index, 1);
  return { stack: result.stack as UnitStack, zone: result.zone };
}

/** Find the best target personnel/ship for an AI to target (opponent's highest power) */
function pickBestOpponentUnit(
  state: GameState,
  playerIndex: number,
  filter?: (def: CardDef) => boolean,
): string | undefined {
  const opponentIdx = 1 - playerIndex;
  const opponent = state.players[opponentIdx];
  let best: { instanceId: string; power: number } | null = null;
  for (const stack of opponent.zones.alert) {
    const top = stack.cards[0];
    if (!top?.faceUp) continue;
    const def = getCardDef(top.defId);
    if (!def || (def.type !== "personnel" && def.type !== "ship")) continue;
    if (filter && !filter(def)) continue;
    const power = def.power ?? 0;
    if (!best || power > best.power) {
      best = { instanceId: top.instanceId, power };
    }
  }
  return best?.instanceId;
}

/** Get the linked mission handler for a unit stack */
function getLinkedMissionHandlers(
  unitStack: UnitStack,
): { card: CardInstance; def: CardDef; handler: MissionAbilityHandler }[] {
  const results: { card: CardInstance; def: CardDef; handler: MissionAbilityHandler }[] = [];
  for (const mc of unitStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler) results.push({ card: mc, def, handler });
  }
  return results;
}

function shuffle(arr: CardInstance[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
// ONE-SHOT MISSION REGISTRATIONS
// ============================================================

// BSG1-056 Accused — Target personnel gains Cylon trait until end of turn
register("accused", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel" && !def.traits?.includes("Cylon" as Trait)) {
            targets.push(top.instanceId);
          }
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ??
      pickBestOpponentUnit(
        state,
        playerIndex,
        (d) => d.type === "personnel" && !d.traits?.includes("Cylon" as Trait),
      );
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner) {
        const p = state.players[owner.playerIndex];
        if (!p.temporaryTraitGrants) p.temporaryTraitGrants = {};
        if (!p.temporaryTraitGrants[target]) p.temporaryTraitGrants[target] = [];
        p.temporaryTraitGrants[target].push("Cylon" as Trait);
        const def = getCardDef(owner.stack.cards[0].defId);
        log.push(`Accused: ${helpers.cardName(def)} gains Cylon trait.`);
      }
    } else {
      log.push("Accused: no valid target.");
    }
  },
});

// BSG1-057 Alert Five — Ready all Fighters
register("alert-five", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      const toReady: UnitStack[] = [];
      const remaining: UnitStack[] = [];
      for (const stack of p.zones.reserve) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (def?.traits?.includes("Fighter" as Trait)) {
            toReady.push(stack);
            count++;
            continue;
          }
        }
        remaining.push(stack);
      }
      p.zones.reserve = remaining;
      p.zones.alert.push(...toReady);
    }
    log.push(`Alert Five: readied ${count} Fighter(s).`);
  },
});

// BSG1-058 Arrow Of Apollo — Search deck for any card, put in hand
register("arrow-of-apollo", {
  category: "one-shot",
  canResolve(state, playerIndex) {
    return state.players[playerIndex].deck.length > 0;
  },
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    if (player.deck.length === 0) {
      log.push("Arrow Of Apollo: deck empty.");
      return;
    }
    // Set pendingChoice to let player pick a card from deck
    state.pendingChoice = {
      type: "arrow-of-apollo-search",
      playerIndex,
      cards: [...player.deck],
    };
  },
});

// BSG1-059 Article 23 — Each player: sacrifice personnel OR lose 2 influence
register("article-23", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    log.push("Article 23: each player must sacrifice a personnel or lose 2 influence.");
    // Start with the resolving player
    const personnel: CardInstance[] = [];
    const player = state.players[playerIndex];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel") personnel.push(top);
      }
    }
    state.pendingChoice = {
      type: "article-23",
      playerIndex,
      cards: personnel,
      context: {
        remainingPlayers: state.players.map((_, i) => i).filter((i) => i !== playerIndex),
      },
    };
  },
});

// BSG1-060 Based On Scriptures — Gain 5 influence
register("based-on-scriptures", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    state.players[playerIndex].influence += 5;
    log.push(
      `Based On Scriptures: gain 5 influence. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// BSG1-062 Colonial Day — Ready all Civilian units
register("colonial-day", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      const toReady: UnitStack[] = [];
      const remaining: UnitStack[] = [];
      for (const stack of p.zones.reserve) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (
            def?.traits?.includes("Civilian" as Trait) &&
            (def.type === "personnel" || def.type === "ship")
          ) {
            toReady.push(stack);
            count++;
            continue;
          }
        }
        remaining.push(stack);
      }
      p.zones.reserve = remaining;
      p.zones.alert.push(...toReady);
    }
    log.push(`Colonial Day: readied ${count} Civilian unit(s).`);
  },
});

// BSG1-066 Earn Freedom Points — Gain 1 influence per Civilian unit or Civilian mission you control
register("earn-freedom-points", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    let count = 0;
    // Count Civilian units
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.traits?.includes("Civilian" as Trait)) count++;
      }
    }
    // Count Civilian persistent missions
    for (const mc of player.zones.persistentMissions ?? []) {
      const def = getCardDef(mc.defId);
      if (def?.traits?.includes("Civilian" as Trait)) count++;
    }
    player.influence += count;
    log.push(`Earn Freedom Points: gain ${count} influence. (Now ${player.influence})`);
  },
});

// BSG1-067 Earn Your Wings — Ready all Pilots
register("earn-your-wings", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      const toReady: UnitStack[] = [];
      const remaining: UnitStack[] = [];
      for (const stack of p.zones.reserve) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (def?.traits?.includes("Pilot" as Trait)) {
            toReady.push(stack);
            count++;
            continue;
          }
        }
        remaining.push(stack);
      }
      p.zones.reserve = remaining;
      p.zones.alert.push(...toReady);
    }
    log.push(`Earn Your Wings: readied ${count} Pilot(s).`);
  },
});

// BSG1-069 Formal Dress Function — Commit all Officers
register("formal-dress-function", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      const toCommit: UnitStack[] = [];
      const remaining: UnitStack[] = [];
      for (const stack of p.zones.alert) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (def?.traits?.includes("Officer" as Trait)) {
            toCommit.push(stack);
            count++;
            continue;
          }
        }
        remaining.push(stack);
      }
      p.zones.alert = remaining;
      p.zones.reserve.push(...toCommit);
    }
    log.push(`Formal Dress Function: committed ${count} Officer(s).`);
  },
});

// BSG1-070 Full Scale Assault — All your units get +1 power (phase-scoped)
register("full-scale-assault", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    let count = 0;
    for (const stack of player.zones.alert) {
      const top = stack.cards[0];
      if (top?.faceUp) {
        const def = getCardDef(top.defId);
        if (def?.type === "personnel" || def?.type === "ship") {
          helpers.applyPowerBuff(state, top.instanceId, 1, log);
          count++;
        }
      }
    }
    log.push(`Full Scale Assault: ${count} unit(s) get +1 power.`);
  },
});

// BSG1-072 Green: You're A Normal Human — Bounce Cylon unit to hand, owner gains 2
register("green-normal-human", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (
            def &&
            (def.type === "personnel" || def.type === "ship") &&
            def.traits?.includes("Cylon" as Trait)
          ) {
            targets.push(top.instanceId);
          }
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ??
      pickBestOpponentUnit(
        state,
        playerIndex,
        (d) => d.traits?.includes("Cylon" as Trait) === true,
      );
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner) {
        const def = getCardDef(owner.stack.cards[0].defId);
        const removed = removeUnitFromPlay(owner.player, target);
        if (removed) {
          for (const card of removed.stack.cards) {
            owner.player.hand.push(card);
          }
        }
        owner.player.influence += 2;
        log.push(
          `Green: ${helpers.cardName(def)} returned to hand. Player ${owner.playerIndex + 1} gains 2 influence.`,
        );
      }
    } else {
      log.push("Green: no valid Cylon target.");
    }
  },
});

// BSG1-073 Hand Of God — Draw 2 cards
register("hand-of-god", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    helpers.drawCards(
      state.players[playerIndex],
      2,
      log,
      `Player ${playerIndex + 1}`,
      state,
      playerIndex,
    );
    log.push("Hand Of God: draw 2 cards.");
  },
});

// BSG1-074 Hunt For Tylium — Put a supply card from hand to resource area
register("hunt-for-tylium", {
  category: "one-shot",
  canResolve(state, playerIndex) {
    return state.players[playerIndex].hand.length > 0;
  },
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    if (player.hand.length === 0) {
      log.push("Hunt For Tylium: no cards in hand.");
      return;
    }
    // Set pendingChoice to let player pick a card from hand
    state.pendingChoice = {
      type: "hunt-for-tylium-hand",
      playerIndex,
      cards: [...player.hand],
    };
  },
});

// BSG1-077 Investigation — Put target personnel on top of owner's deck; that player loses 2 influence
register("investigation", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel") targets.push(top.instanceId);
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ?? pickBestOpponentUnit(state, playerIndex, (d) => d.type === "personnel");
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner) {
        const def = getCardDef(owner.stack.cards[0].defId);
        const removed = removeUnitFromPlay(owner.player, target);
        if (removed) {
          // Put cards on top of deck (top card first)
          for (const card of removed.stack.cards) {
            owner.player.deck.unshift(card);
          }
        }
        helpers.applyInfluenceLoss(state, owner.playerIndex, 2, log, helpers.bases);
        log.push(
          `Investigation: ${helpers.cardName(def)} put on top of deck. Player ${owner.playerIndex + 1} loses 2 influence.`,
        );
      }
    } else {
      log.push("Investigation: no valid target.");
    }
  },
});

// BSG1-078 Kobol's Last Gleaming — Shuffle target personnel into owner's deck
register("kobols-last-gleaming", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel") targets.push(top.instanceId);
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ?? pickBestOpponentUnit(state, playerIndex, (d) => d.type === "personnel");
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner) {
        const def = getCardDef(owner.stack.cards[0].defId);
        const removed = removeUnitFromPlay(owner.player, target);
        if (removed) {
          for (const card of removed.stack.cards) {
            owner.player.deck.push(card);
          }
          shuffle(owner.player.deck);
        }
        log.push(`Kobol's Last Gleaming: ${helpers.cardName(def)} shuffled into deck.`);
      }
    } else {
      log.push("Kobol's Last Gleaming: no valid target.");
    }
  },
});

// BSG1-079 Life Has A Melody — Search deck for Cylon card, put in hand
register("life-has-a-melody", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    // Filter deck for Cylon cards
    const cylonCards = player.deck.filter((c) => {
      const def = getCardDef(c.defId);
      return def?.traits?.includes("Cylon" as Trait);
    });
    if (cylonCards.length === 0) {
      shuffle(player.deck);
      log.push("Life Has A Melody: no Cylon card found in deck.");
      return;
    }
    // Set pendingChoice to let player pick a Cylon card from deck
    state.pendingChoice = {
      type: "life-has-a-melody-search",
      playerIndex,
      cards: cylonCards,
    };
  },
});

// BSG1-080 Meet The New Boss — Exchange personnel in hand with same-power personnel you control (errata)
register("meet-the-new-boss", {
  category: "one-shot",
  canResolve(state, playerIndex) {
    const player = state.players[playerIndex];
    const handPowers = new Set<number>();
    for (const card of player.hand) {
      const def = getCardDef(card.defId);
      if (def?.type === "personnel") handPowers.add(def.power ?? 0);
    }
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel" && handPowers.has(def.power ?? 0)) return true;
      }
    }
    return false;
  },
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    // Find which personnel in hand have matching-power personnel in play
    const fieldPowers = new Set<number>();
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel") fieldPowers.add(def.power ?? 0);
      }
    }
    const validHand = player.hand.filter((c) => {
      const def = getCardDef(c.defId);
      return def?.type === "personnel" && fieldPowers.has(def.power ?? 0);
    });
    if (validHand.length === 0) {
      log.push("Meet The New Boss: no valid exchange found.");
      return;
    }
    state.pendingChoice = {
      type: "meet-new-boss-hand",
      playerIndex,
      cards: validHand,
    };
  },
});

// BSG1-083 Obliterate The Base — Defeat target asset with no supply cards
register("obliterate-the-base", {
  category: "one-shot",
  getResolveTargets(state, playerIndex) {
    const targets: string[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (stack.supplyCards.length === 0) {
          targets.push(stack.topCard.instanceId);
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    // Find target asset by instanceId, or AI fallback
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (targetId ? stack.topCard.instanceId === targetId : stack.supplyCards.length === 0) {
          p.zones.resourceStacks.splice(i, 1);
          p.discard.push(stack.topCard);
          log.push("Obliterate The Base: defeated target asset.");
          return;
        }
      }
    }
    log.push("Obliterate The Base: no valid asset target.");
  },
});

// BSG1-084 Overtime — Ready all ships you control
register("overtime", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    let count = 0;
    const toReady: UnitStack[] = [];
    const remaining: UnitStack[] = [];
    for (const stack of player.zones.reserve) {
      const top = stack.cards[0];
      if (top?.faceUp) {
        const def = getCardDef(top.defId);
        if (def?.type === "ship") {
          toReady.push(stack);
          count++;
          continue;
        }
      }
      remaining.push(stack);
    }
    player.zones.reserve = remaining;
    player.zones.alert.push(...toReady);
    log.push(`Overtime: readied ${count} ship(s).`);
  },
});

// BSG1-086 Picking Sides — Choose singular personnel; opponents sacrifice same-title personnel
register("picking-sides", {
  category: "one-shot",
  getResolveTargets(state, playerIndex) {
    const targets: string[] = [];
    const player = state.players[playerIndex];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel" && def.title) targets.push(top.instanceId);
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const player = state.players[playerIndex];
    let chosenTitle: string | undefined;
    if (targetId) {
      const found = findUnitOwner(state, targetId);
      if (found) {
        const def = getCardDef(found.stack.cards[0].defId);
        chosenTitle = def?.title;
      }
    } else {
      // AI fallback: pick first singular
      for (const stack of player.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel" && def.title) {
          chosenTitle = def.title;
          break;
        }
      }
    }
    if (!chosenTitle) {
      log.push("Picking Sides: no singular personnel to choose.");
      return;
    }
    log.push(`Picking Sides: chose ${chosenTitle}.`);
    // Opponents sacrifice personnel with same title
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel" && def.title === chosenTitle) {
            helpers.defeatUnit(p, top.instanceId, log, state, pi);
            log.push(`Picking Sides: Player ${pi + 1} sacrifices ${helpers.cardName(def)}.`);
          }
        }
      }
    }
  },
});

// BSG1-087 Press Junket — Gain 2 influence
register("press-junket", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    state.players[playerIndex].influence += 2;
    log.push(`Press Junket: gain 2 influence. (Now ${state.players[playerIndex].influence})`);
  },
});

// BSG1-088 Pulling Rank — Commit two target personnel
register("pulling-rank", {
  category: "one-shot",
  canResolve(state, _playerIndex) {
    // Need at least 1 alert personnel to target
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel") return true;
      }
    }
    return false;
  },
  onResolve(state, playerIndex, _targetId, log) {
    // Collect all alert personnel from all players
    const personnel: CardInstance[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel") personnel.push(top);
      }
    }
    if (personnel.length === 0) {
      log.push("Pulling Rank: no personnel to commit.");
      return;
    }
    state.pendingChoice = {
      type: "pulling-rank-1",
      playerIndex,
      cards: personnel,
    };
  },
});

// BSG1-089 Red: You're An Evil Cylon — Bounce Cylon unit to hand; owner loses 2 influence
register("red-evil-cylon", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (
            def &&
            (def.type === "personnel" || def.type === "ship") &&
            def.traits?.includes("Cylon" as Trait)
          ) {
            targets.push(top.instanceId);
          }
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ??
      pickBestOpponentUnit(
        state,
        playerIndex,
        (d) => d.traits?.includes("Cylon" as Trait) === true,
      );
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner) {
        const def = getCardDef(owner.stack.cards[0].defId);
        const removed = removeUnitFromPlay(owner.player, target);
        if (removed) {
          for (const card of removed.stack.cards) owner.player.hand.push(card);
        }
        helpers.applyInfluenceLoss(state, owner.playerIndex, 2, log, helpers.bases);
        log.push(
          `Red: ${helpers.cardName(def)} returned to hand. Player ${owner.playerIndex + 1} loses 2 influence.`,
        );
      }
    } else {
      log.push("Red: no valid Cylon target.");
    }
  },
});

// BSG1-090 Refueling Operation — Shuffle discard pile into deck
register("refueling-operation", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    player.deck.push(...player.discard);
    player.discard = [];
    shuffle(player.deck);
    log.push("Refueling Operation: shuffled discard pile into deck.");
  },
});

// BSG1-091 Relieved Of Duty — Return target alert personnel to owner's hand
register("relieved-of-duty", {
  category: "one-shot",
  getResolveTargets(state, _playerIndex) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "personnel") targets.push(top.instanceId);
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const target =
      targetId ?? pickBestOpponentUnit(state, playerIndex, (d) => d.type === "personnel");
    if (target) {
      const owner = findUnitOwner(state, target);
      if (owner && owner.zone === "alert") {
        const def = getCardDef(owner.stack.cards[0].defId);
        const removed = removeUnitFromPlay(owner.player, target);
        if (removed) {
          for (const card of removed.stack.cards) owner.player.hand.push(card);
        }
        log.push(`Relieved Of Duty: ${helpers.cardName(def)} returned to hand.`);
      }
    } else {
      log.push("Relieved Of Duty: no valid target.");
    }
  },
});

// BSG1-092 Shuttle Diplomacy — Gain 3 influence
register("shuttle-diplomacy", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    state.players[playerIndex].influence += 3;
    log.push(`Shuttle Diplomacy: gain 3 influence. (Now ${state.players[playerIndex].influence})`);
  },
});

// BSG1-094 Suspicions — Target player loses 2 influence
register("suspicions", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    const opIdx = 1 - playerIndex;
    helpers.applyInfluenceLoss(state, opIdx, 2, log, helpers.bases);
    log.push(`Suspicions: Player ${opIdx + 1} loses 2 influence.`);
  },
});

// BSG1-095 Trying Times — Gain 1 influence per alert Politician in play
register("trying-times", {
  category: "one-shot",
  onResolve(state, playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (def?.traits?.includes("Politician" as Trait)) count++;
        }
      }
    }
    state.players[playerIndex].influence += count;
    log.push(
      `Trying Times: ${count} alert Politician(s) → gain ${count} influence. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// BSG1-097 Working Together — Ready all Politicians
register("working-together", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    let count = 0;
    for (const p of state.players) {
      const toReady: UnitStack[] = [];
      const remaining: UnitStack[] = [];
      for (const stack of p.zones.reserve) {
        const top = stack.cards[0];
        if (top?.faceUp) {
          const def = getCardDef(top.defId);
          if (def?.traits?.includes("Politician" as Trait)) {
            toReady.push(stack);
            count++;
            continue;
          }
        }
        remaining.push(stack);
      }
      p.zones.reserve = remaining;
      p.zones.alert.push(...toReady);
    }
    log.push(`Working Together: readied ${count} Politician(s).`);
  },
});

// BSG2-046 Assassination — Commit+exhaust own personnel → defeat target personnel
register("assassination", {
  category: "one-shot",
  canResolve(state, playerIndex) {
    const player = state.players[playerIndex];
    // Need own alert non-exhausted personnel
    let hasSource = false;
    for (const stack of player.zones.alert) {
      const top = stack.cards[0];
      if (!top?.faceUp || stack.exhausted) continue;
      const def = getCardDef(top.defId);
      if (def?.type === "personnel") {
        hasSource = true;
        break;
      }
    }
    if (!hasSource) return false;
    // Need any personnel to target
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel") return true;
        }
      }
    }
    return false;
  },
  onResolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    // Collect own alert non-exhausted personnel as source options
    const sources: CardInstance[] = [];
    for (const stack of player.zones.alert) {
      const top = stack.cards[0];
      if (!top?.faceUp || stack.exhausted) continue;
      const def = getCardDef(top.defId);
      if (def?.type === "personnel") sources.push(top);
    }
    if (sources.length === 0) {
      log.push("Assassination: no personnel to commit.");
      return;
    }
    state.pendingChoice = {
      type: "assassination-source",
      playerIndex,
      cards: sources,
    };
  },
});

// BSG2-061 False Peace — End execution, extra execution+cylon phases after normal cylon
register("false-peace", {
  category: "one-shot",
  onResolve(state, _playerIndex, _targetId, log) {
    state.extraPhases = ["execution"];
    state.forceEndExecution = true;
    log.push("False Peace: execution phase ends. Extra execution and Cylon phases will follow.");
  },
});

// BSG2-077 The Hunters — Defeat target mission with Link keyword
register("the-hunters", {
  category: "one-shot",
  getResolveTargets(state, playerIndex) {
    const targets: string[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          for (const mc of stack.linkedMissions ?? []) {
            targets.push(mc.instanceId);
          }
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    // Find and remove the targeted linked mission
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zone) {
          const linked = stack.linkedMissions ?? [];
          for (let i = 0; i < linked.length; i++) {
            if (targetId ? linked[i].instanceId === targetId : true) {
              const [mission] = linked.splice(i, 1);
              p.discard.push(mission);
              const def = getCardDef(mission.defId);
              log.push(
                `The Hunters: defeated linked mission ${def ? helpers.cardName(def) : "unknown"}.`,
              );
              return;
            }
          }
        }
      }
    }
    log.push("The Hunters: no Link mission found to defeat.");
  },
});

// BSG2-078 Thinking Outside The Box — Defeat target asset with no supply cards
register("thinking-outside-box", {
  category: "one-shot",
  getResolveTargets(state, playerIndex) {
    const targets: string[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (stack.supplyCards.length === 0) {
          targets.push(stack.topCard.instanceId);
        }
      }
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      if (pi === playerIndex) continue;
      const p = state.players[pi];
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (targetId ? stack.topCard.instanceId === targetId : stack.supplyCards.length === 0) {
          p.zones.resourceStacks.splice(i, 1);
          p.discard.push(stack.topCard);
          log.push("Thinking Outside The Box: defeated target asset.");
          return;
        }
      }
    }
    log.push("Thinking Outside The Box: no valid asset target.");
  },
});

// ============================================================
// PERSISTENT MISSION REGISTRATIONS
// ============================================================

// --- Passive Power Buffs ---

// BSG1-061 CAG — All ships you control get +1 power
register("cag", {
  category: "persistent",
  getPowerModifier(state, unitStack, ownerIndex, _context) {
    const top = unitStack.cards[0];
    if (!top) return 0;
    const unitDef = getCardDef(top.defId);
    if (unitDef?.type !== "ship") return 0;
    // Check if ownerIndex has this persistent mission
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "cag",
    );
    return has ? 1 : 0;
  },
});

// BSG1-075 Increased Loadout — All Fighters get +1 power
register("increased-loadout", {
  category: "persistent",
  getPowerModifier(state, unitStack, ownerIndex, _context) {
    const top = unitStack.cards[0];
    if (!top) return 0;
    const unitDef = getCardDef(top.defId);
    if (!unitDef?.traits?.includes("Fighter" as Trait)) return 0;
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "increased-loadout",
    );
    return has ? 1 : 0;
  },
});

// BSG1-093 Stern Leadership — All Pilots get +1 power
register("stern-leadership", {
  category: "persistent",
  getPowerModifier(state, unitStack, ownerIndex, _context) {
    const top = unitStack.cards[0];
    if (!top) return 0;
    const unitDef = getCardDef(top.defId);
    if (!unitDef?.traits?.includes("Pilot" as Trait)) return 0;
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "stern-leadership",
    );
    return has ? 1 : 0;
  },
});

// BSG2-049 Caprican Ideals — All Civilian units get +1 power
register("caprican-ideals", {
  category: "persistent",
  getPowerModifier(state, unitStack, ownerIndex, _context) {
    const top = unitStack.cards[0];
    if (!top) return 0;
    const unitDef = getCardDef(top.defId);
    if (!unitDef?.traits?.includes("Civilian" as Trait)) return 0;
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "caprican-ideals",
    );
    return has ? 1 : 0;
  },
});

// --- Fleet Defense Modifiers ---

// BSG1-085 Persistent Assault — Fleet defense -2
register("persistent-assault", {
  category: "persistent",
  fleetDefenseModifier: -2,
});

// BSG2-052 Coming Out To Fight — Fleet defense +4
register("coming-out-to-fight", {
  category: "persistent",
  fleetDefenseModifier: 4,
});

// --- Cylon Threat Modifier ---

// BSG2-055 Cylon Ambush — All Cylon threats get +1 power
register("cylon-ambush", {
  category: "persistent",
  cylonThreatBonus: 1,
});

// --- Keyword Grants ---

// BSG2-073 Ram The Ship — All ships you control gain Scramble
register("ram-the-ship", {
  category: "persistent",
  getKeywordGrants(state, unitStack, ownerIndex) {
    const top = unitStack.cards[0];
    if (!top) return [];
    const unitDef = getCardDef(top.defId);
    if (unitDef?.type !== "ship") return [];
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "ram-the-ship",
    );
    return has ? ["Scramble"] : [];
  },
});

// BSG2-075 Sam Battery — All personnel you control gain Scramble
register("sam-battery", {
  category: "persistent",
  getKeywordGrants(state, unitStack, ownerIndex) {
    const top = unitStack.cards[0];
    if (!top) return [];
    const unitDef = getCardDef(top.defId);
    if (unitDef?.type !== "personnel") return [];
    const player = state.players[ownerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "sam-battery",
    );
    return has ? ["Scramble"] : [];
  },
});

// --- Defeat Prevention ---

// BSG1-068 Flight School — When ship you control would be defeated, sacrifice this instead
register("flight-school", {
  category: "persistent",
  interceptDefeat(state, playerIndex, unitType, _unitInstanceId, log) {
    if (unitType !== "ship") return false;
    const player = state.players[playerIndex];
    const missions = player.zones.persistentMissions ?? [];
    const idx = missions.findIndex((m) => getCardDef(m.defId)?.abilityId === "flight-school");
    if (idx < 0) return false;
    const [mission] = missions.splice(idx, 1);
    player.discard.push(mission);
    log.push("Flight School: sacrificed to prevent ship defeat.");
    return true;
  },
});

// BSG1-081 Misdirection — When personnel you control would be defeated, sacrifice this instead
register("misdirection", {
  category: "persistent",
  interceptDefeat(state, playerIndex, unitType, _unitInstanceId, log) {
    if (unitType !== "personnel") return false;
    const player = state.players[playerIndex];
    const missions = player.zones.persistentMissions ?? [];
    const idx = missions.findIndex((m) => getCardDef(m.defId)?.abilityId === "misdirection");
    if (idx < 0) return false;
    const [mission] = missions.splice(idx, 1);
    player.discard.push(mission);
    log.push("Misdirection: sacrificed to prevent personnel defeat.");
    return true;
  },
});

// --- Triggered ---

// BSG1-065 Dradis Contact — Each time you play event, may gain 1 influence
register("dradis-contact", {
  category: "persistent",
  onEventPlay(state, playerIndex, log) {
    const player = state.players[playerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "dradis-contact",
    );
    if (has) {
      player.influence += 1;
      log.push(`Dradis Contact: gain 1 influence for playing event. (Now ${player.influence})`);
    }
  },
});

// BSG1-071 God Has A Plan — Cylon card mystic reveal +1
register("god-has-a-plan", {
  category: "persistent",
  onMysticReveal(state, playerIndex, value, cardDef) {
    const player = state.players[playerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "god-has-a-plan",
    );
    if (has && cardDef.traits?.includes("Cylon" as Trait)) {
      return value + 1;
    }
    return value;
  },
});

// BSG1-082 Multiple Contacts — At ready phase start, draw 1 card
register("multiple-contacts", {
  category: "persistent",
  onReadyPhaseStart(state, playerIndex, log) {
    const player = state.players[playerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "multiple-contacts",
    );
    if (has) {
      helpers.drawCards(player, 1, log, `Player ${playerIndex + 1}`, state, playerIndex);
      log.push("Multiple Contacts: draw 1 card at ready phase start.");
    }
  },
});

// BSG2-079 Tightening The Noose — Each card drawn in execution phase → discard one
register("tightening-the-noose", {
  category: "persistent",
  onDraw(state, playerIndex, drawCount, log) {
    if (state.phase !== "execution") return;
    // Check if ANY player has this persistent mission
    let active = false;
    for (const p of state.players) {
      if (
        (p.zones.persistentMissions ?? []).some(
          (m) => getCardDef(m.defId)?.abilityId === "tightening-the-noose",
        )
      ) {
        active = true;
        break;
      }
    }
    if (!active) return;
    const player = state.players[playerIndex];
    // Discard N cards (lowest mystic value)
    for (let i = 0; i < drawCount && player.hand.length > 0; i++) {
      let worstIdx = 0;
      let worstMystic = Infinity;
      for (let j = 0; j < player.hand.length; j++) {
        const def = getCardDef(player.hand[j].defId);
        if ((def?.mysticValue ?? 0) < worstMystic) {
          worstMystic = def?.mysticValue ?? 0;
          worstIdx = j;
        }
      }
      const [card] = player.hand.splice(worstIdx, 1);
      player.discard.push(card);
    }
    log.push(`Tightening The Noose: Player ${playerIndex + 1} discards ${drawCount} card(s).`);
  },
});

// --- Activated ---

// BSG1-076 Interim Quorum — Commit+exhaust Politician → target other personnel +3 power
register("interim-quorum", {
  category: "persistent",
  activation: {
    cost: "commit-exhaust-politician",
    usableIn: ["execution", "challenge", "cylon-challenge"],
    getTargets(state, playerIndex, _sourceId) {
      // Find a Politician to commit+exhaust
      const player = state.players[playerIndex];
      const hasPolitician = player.zones.alert.some((s) => {
        const top = s.cards[0];
        if (!top?.faceUp || s.exhausted) return false;
        const def = getCardDef(top.defId);
        return def?.traits?.includes("Politician" as Trait);
      });
      if (!hasPolitician) return [];
      // Targets: any other alert personnel
      const targets: string[] = [];
      for (const p of state.players) {
        for (const stack of p.zones.alert) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "personnel") targets.push(top.instanceId);
        }
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, _sourceId, targetId, log) {
      const player = state.players[playerIndex];
      // Find cheapest Politician to commit+exhaust
      let politicianId: string | undefined;
      let cheapest = Infinity;
      for (const stack of player.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp || stack.exhausted) continue;
        const def = getCardDef(top.defId);
        if (def?.traits?.includes("Politician" as Trait) && (def.power ?? 0) < cheapest) {
          cheapest = def.power ?? 0;
          politicianId = top.instanceId;
        }
      }
      if (!politicianId) return;
      const found = findUnitInZone(player.zones.alert, politicianId);
      if (found) {
        found.stack.exhausted = true;
        commitUnitLocal(player, politicianId, log);
      }
      if (targetId) {
        helpers.applyPowerBuff(state, targetId, 3, log);
        log.push("Interim Quorum: target personnel gets +3 power.");
      }
    },
  },
});

// BSG2-053 Critical Component — Exhaust mission + exhaust resource → extra action + cost reduction by 2
register("critical-component", {
  category: "persistent",
  activation: {
    cost: "exhaust-mission",
    usableIn: ["execution"],
    getTargets(state, playerIndex, _sourceId) {
      const player = state.players[playerIndex];
      // Need a non-exhausted resource stack with at least 1 supply card
      const hasStack = player.zones.resourceStacks.some(
        (s) => !s.exhausted && s.supplyCards.length > 0,
      );
      return hasStack ? null : []; // null = no target needed (auto-select resource stack)
    },
    resolve(state, playerIndex, _sourceId, _targetId, log) {
      const player = state.players[playerIndex];
      // Find mission and exhaust it
      const missions = player.zones.persistentMissions ?? [];
      const mission = missions.find((m) => getCardDef(m.defId)?.abilityId === "critical-component");
      if (mission) mission.faceUp = false; // exhaust
      // Find eligible resource stacks (non-exhausted, has supply cards)
      const eligible: { card: CardInstance; stackIndex: number }[] = [];
      for (let i = 0; i < player.zones.resourceStacks.length; i++) {
        const stack = player.zones.resourceStacks[i];
        if (!stack.exhausted && stack.supplyCards.length > 0) {
          eligible.push({ card: stack.topCard, stackIndex: i });
        }
      }
      if (eligible.length === 0) return;
      if (eligible.length === 1) {
        // Only one option — exhaust it directly
        player.zones.resourceStacks[eligible[0].stackIndex].exhausted = true;
        player.extraActionsRemaining = (player.extraActionsRemaining ?? 0) + 1;
        player.costReduction = { persuasion: 2, logistics: 2, security: 2 };
        log.push("Critical Component: extra action granted, next card costs 2 less.");
      } else {
        // Multiple options — prompt player
        state.pendingChoice = {
          type: "critical-component-stack",
          playerIndex,
          cards: eligible.map((e) => e.card),
          context: { stackIndices: eligible.map((e) => e.stackIndex) },
        };
      }
    },
  },
});

// BSG2-056 Cylon Betrayal — Sacrifice → target player goes first in Cylon phase
register("cylon-betrayal", {
  category: "persistent",
  activation: {
    cost: "sacrifice-mission",
    usableIn: ["execution"],
    getTargets(_state, _playerIndex, _sourceId) {
      return null; // target is opponent (auto in 2-player)
    },
    resolve(state, playerIndex, _sourceId, _targetId, log) {
      const player = state.players[playerIndex];
      // Sacrifice this mission
      const missions = player.zones.persistentMissions ?? [];
      const idx = missions.findIndex((m) => getCardDef(m.defId)?.abilityId === "cylon-betrayal");
      if (idx >= 0) {
        const [mission] = missions.splice(idx, 1);
        player.discard.push(mission);
      }
      // In a 2-player game, the opponent goes first in Cylon phase
      const oppIndex = 1 - playerIndex;
      state.cylonPhaseFirstOverride = oppIndex;
      log.push(
        `Cylon Betrayal: sacrificed. Player ${oppIndex + 1} goes first in next Cylon phase.`,
      );
    },
  },
});

// --- Resolve-Only + Persistent ---

// BSG1-063 Combat Air Patrol — On resolve: commit target Pilot, gain 1 influence
register("combat-air-patrol", {
  category: "persistent",
  getResolveTargets(state, playerIndex) {
    const targets: string[] = [];
    const player = state.players[playerIndex];
    for (const stack of player.zones.alert) {
      const top = stack.cards[0];
      if (!top?.faceUp) continue;
      const def = getCardDef(top.defId);
      if (def?.traits?.includes("Pilot" as Trait)) targets.push(top.instanceId);
    }
    return targets;
  },
  onResolve(state, playerIndex, targetId, log) {
    const player = state.players[playerIndex];
    if (targetId) {
      commitUnitLocal(player, targetId, log);
    } else {
      // AI fallback: commit first Pilot
      for (const stack of player.zones.alert) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.traits?.includes("Pilot" as Trait)) {
          commitUnitLocal(player, top.instanceId, log);
          break;
        }
      }
    }
    player.influence += 1;
    log.push(`Combat Air Patrol: gain 1 influence. (Now ${player.influence})`);
  },
});

// --- Special Rule Modifiers ---

// BSG1-064 Difference Of Opinion — Challengers must pay 1 resource per challenge against you
register("difference-of-opinion", {
  category: "persistent",
  challengeCostModifier(state, _challengerIndex, defenderIndex) {
    const defender = state.players[defenderIndex];
    const has = (defender.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "difference-of-opinion",
    );
    return has ? 1 : 0;
  },
});

// BSG1-096 We'll See You Again — Cylon units not singular (errata: singular cards don't overlay Cylon stacks)
register("well-see-you-again", {
  category: "persistent",
  preventOverlay(state, playerIndex, unitDef) {
    const player = state.players[playerIndex];
    const has = (player.zones.persistentMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "well-see-you-again",
    );
    if (!has) return false;
    // Prevent overlay if the target stack has Cylon trait
    return unitDef.traits?.includes("Cylon" as Trait) === true;
  },
});

// ============================================================
// LINK MISSION REGISTRATIONS
// ============================================================

// --- Link Personnel: Passive ---

// BSG2-048 Blackmail — Personnel gains Manipulate
register("blackmail", {
  category: "link",
  linkTarget: "personnel",
  getKeywordGrants(_state, unitStack, _ownerIndex) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "blackmail",
    );
    return has ? ["Manipulate"] : [];
  },
});

// BSG2-050 Caprican Supplies — Personnel +1 power
register("caprican-supplies", {
  category: "link",
  linkTarget: "personnel",
  getPowerModifier(_state, unitStack, _ownerIndex, _context) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "caprican-supplies",
    );
    return has ? 1 : 0;
  },
});

// BSG2-057 Damning Evidence — Personnel can't challenge
register("damning-evidence", {
  category: "link",
  linkTarget: "personnel",
  canChallenge: false,
});

// BSG2-064 Independent Tribunal — Units power ≤2 can't defend against this personnel
// (Handled in engine's defender filter via special check)
register("independent-tribunal", {
  category: "link",
  linkTarget: "personnel",
});

// BSG2-080 To Your Ships — Personnel gains Scramble
register("to-your-ships", {
  category: "link",
  linkTarget: "personnel",
  getKeywordGrants(_state, unitStack, _ownerIndex) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "to-your-ships",
    );
    return has ? ["Scramble"] : [];
  },
});

// --- Link Personnel: Activated ---

// BSG2-045 Are You Alive? — Commit: target unit -2 power
register("are-you-alive", {
  category: "link",
  linkTarget: "personnel",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution", "challenge", "cylon-challenge"],
    getTargets(state, playerIndex, _sourceId) {
      // Target any unit
      const targets: string[] = [];
      for (const p of state.players) {
        for (const stack of [...p.zones.alert, ...p.zones.reserve]) {
          const top = stack.cards[0];
          if (top?.faceUp) targets.push(top.instanceId);
        }
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, sourceId, targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      if (targetId) {
        helpers.applyPowerBuff(state, targetId, -2, log);
        log.push("Are You Alive?: target unit gets -2 power.");
      }
    },
  },
});

// BSG2-063 In Love With A Machine — Commit: ready target Cylon unit
register("in-love-with-machine", {
  category: "link",
  linkTarget: "personnel",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(state, playerIndex, _sourceId) {
      const player = state.players[playerIndex];
      const targets: string[] = [];
      for (const stack of player.zones.reserve) {
        const top = stack.cards[0];
        if (!top?.faceUp || stack.exhausted) continue;
        const def = getCardDef(top.defId);
        if (def?.traits?.includes("Cylon" as Trait)) {
          targets.push(top.instanceId);
        }
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, sourceId, targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      if (targetId) {
        readyUnitLocal(state.players[playerIndex], targetId, log);
      }
    },
  },
});

// BSG2-070 Plan B — Commit: ready target mission
register("plan-b", {
  category: "link",
  linkTarget: "personnel",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(state, playerIndex, _sourceId) {
      const player = state.players[playerIndex];
      // Find missions in reserve (committed missions)
      const targets: string[] = [];
      for (const stack of player.zones.reserve) {
        const top = stack.cards[0];
        if (!top?.faceUp) continue;
        const def = getCardDef(top.defId);
        if (def?.type === "mission") targets.push(top.instanceId);
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, sourceId, targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      if (targetId) {
        readyUnitLocal(state.players[playerIndex], targetId, log);
      }
    },
  },
});

// BSG2-071 Prophetic Visions — Commit: look at top 2 of deck, arrange
register("prophetic-visions", {
  category: "link",
  linkTarget: "unit",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(_state, _playerIndex, _sourceId) {
      return null; // targets opponent's deck (auto in 2-player)
    },
    resolve(state, playerIndex, sourceId, _targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      const opIdx = 1 - playerIndex;
      const opponent = state.players[opIdx];
      if (opponent.deck.length < 2) {
        if (opponent.deck.length === 1) {
          log.push("Prophetic Visions: only 1 card in opponent's deck, nothing to rearrange.");
        } else {
          log.push("Prophetic Visions: opponent's deck is empty.");
        }
        return;
      }
      // Remove top 2 cards and show as pendingChoice
      const top2 = [opponent.deck.shift()!, opponent.deck.shift()!];
      state.pendingChoice = {
        type: "prophetic-visions-arrange",
        playerIndex,
        cards: top2,
        context: { opponentIndex: opIdx },
      };
    },
  },
});

// BSG2-074 Rudimentary Still — Commit + exhaust resource → extra action + cost reduction by 1
register("rudimentary-still", {
  category: "link",
  linkTarget: "personnel",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(state, playerIndex, _sourceId) {
      const player = state.players[playerIndex];
      const hasStack = player.zones.resourceStacks.some((s) => !s.exhausted);
      return hasStack ? null : [];
    },
    resolve(state, playerIndex, sourceId, _targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      const player = state.players[playerIndex];
      // Exhaust a resource stack
      for (const stack of player.zones.resourceStacks) {
        if (!stack.exhausted) {
          stack.exhausted = true;
          break;
        }
      }
      player.extraActionsRemaining = (player.extraActionsRemaining ?? 0) + 1;
      player.costReduction = { persuasion: 1, logistics: 1, security: 1 };
      log.push("Rudimentary Still: extra action granted, next card costs 1 less.");
    },
  },
});

// BSG2-068 Mysterious Warning — +2 power during Cylon phase
register("mysterious-warning", {
  category: "link",
  linkTarget: "personnel",
  getPowerModifier(state, unitStack, _ownerIndex, context) {
    if (context.phase !== "cylon") return 0;
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "mysterious-warning",
    );
    return has ? 2 : 0;
  },
});

// --- Link Personnel: Triggered ---

// BSG2-062 Hero To The End — When leaves play → controller gains 2 influence
register("hero-to-the-end", {
  category: "link",
  linkTarget: "personnel",
  onLinkedUnitLeavePlay(state, playerIndex, _unitInstanceId, log) {
    state.players[playerIndex].influence += 2;
    log.push(`Hero To The End: gain 2 influence. (Now ${state.players[playerIndex].influence})`);
  },
});

// BSG2-069 Nothin' But The Rain — Each time defeats Cylon threat → +1 additional influence
register("nothin-but-the-rain", {
  category: "link",
  linkTarget: "personnel",
  onCylonThreatDefeat(state, playerIndex, _unitInstanceId, log) {
    state.players[playerIndex].influence += 1;
    log.push(
      `Nothin' But The Rain: +1 additional influence for Cylon defeat. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// --- Link Ship: Passive ---

// BSG2-058 Deck Crew — Ship +1 power
register("deck-crew", {
  category: "link",
  linkTarget: "ship",
  getPowerModifier(_state, unitStack, _ownerIndex, _context) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "deck-crew",
    );
    return has ? 1 : 0;
  },
});

// BSG2-067 Marine Assault — Ship gains Scramble
register("marine-assault", {
  category: "link",
  linkTarget: "ship",
  getKeywordGrants(_state, unitStack, _ownerIndex) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "marine-assault",
    );
    return has ? ["Scramble"] : [];
  },
});

// BSG2-072 Raider Swarm — Ship can't challenge
register("raider-swarm", {
  category: "link",
  linkTarget: "ship",
  canChallenge: false,
});

// BSG2-076 Teamwork — Ship +2 power during Cylon phase
register("teamwork", {
  category: "link",
  linkTarget: "ship",
  getPowerModifier(state, unitStack, _ownerIndex, context) {
    if (context.phase !== "cylon") return 0;
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "teamwork",
    );
    return has ? 2 : 0;
  },
});

// --- Link Ship: Triggered ---

// BSG2-047 Beyond Insane — When personnel you control defeated → sacrifice this ship instead
register("beyond-insane", {
  category: "link",
  linkTarget: "ship",
  interceptDefeat(state, playerIndex, unitType, _unitInstanceId, log) {
    if (unitType !== "personnel") return false;
    const player = state.players[playerIndex];
    // Find a unit with beyond-insane linked
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const linked = stack.linkedMissions ?? [];
        const idx = linked.findIndex((m) => getCardDef(m.defId)?.abilityId === "beyond-insane");
        if (idx < 0) continue;
        // Sacrifice the linked mission AND the ship
        const [mission] = linked.splice(idx, 1);
        player.discard.push(mission);
        // Defeat/sacrifice the ship this was linked to
        const shipId = stack.cards[0]?.instanceId;
        if (shipId) {
          helpers.defeatUnit(player, shipId, log, state, playerIndex);
        }
        log.push("Beyond Insane: sacrificed ship to prevent personnel defeat.");
        return true;
      }
    }
    return false;
  },
});

// BSG2-059 Drawing Strength From Loss — When personnel defeated by Cylon threat → gain 2 influence
// (Triggered from engine when personnel is defeated during Cylon phase)
register("drawing-strength", {
  category: "link",
  linkTarget: "ship",
  // This triggers differently: when ANY of your personnel is defeated by a Cylon threat.
  // The engine will call fireMissionOnCylonDefeat for this.
  onCylonThreatDefeat(state, playerIndex, _unitInstanceId, log) {
    // Check if player has a ship with this linked
    const player = state.players[playerIndex];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const has = (stack.linkedMissions ?? []).some(
          (m) => getCardDef(m.defId)?.abilityId === "drawing-strength",
        );
        if (has) {
          player.influence += 2;
          log.push(`Drawing Strength From Loss: gain 2 influence. (Now ${player.influence})`);
          return;
        }
      }
    }
  },
});

// --- Link Ship: Activated ---

// BSG2-082 Viral Warfare — Commit ship: target player discards a card
register("viral-warfare", {
  category: "link",
  linkTarget: "ship",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(_state, _playerIndex, _sourceId) {
      return null; // opponent (auto in 2-player)
    },
    resolve(state, playerIndex, sourceId, _targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      const opIdx = 1 - playerIndex;
      const opponent = state.players[opIdx];
      if (opponent.hand.length > 0) {
        // Discard lowest mystic value card
        let worstIdx = 0;
        let worstMystic = Infinity;
        for (let i = 0; i < opponent.hand.length; i++) {
          const def = getCardDef(opponent.hand[i].defId);
          if ((def?.mysticValue ?? 0) < worstMystic) {
            worstMystic = def?.mysticValue ?? 0;
            worstIdx = i;
          }
        }
        const [card] = opponent.hand.splice(worstIdx, 1);
        opponent.discard.push(card);
      }
      log.push("Viral Warfare: opponent discards a card.");
    },
  },
});

// --- Link Unit: Passive ---

// BSG2-054 Cutting Through The Hull — Unit gains Scramble
register("cutting-through-hull", {
  category: "link",
  linkTarget: "unit",
  getKeywordGrants(_state, unitStack, _ownerIndex) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "cutting-through-hull",
    );
    return has ? ["Scramble"] : [];
  },
});

// BSG2-060 Explosive Rounds — Unit +2 power during Cylon phase
register("explosive-rounds", {
  category: "link",
  linkTarget: "unit",
  getPowerModifier(state, unitStack, _ownerIndex, context) {
    if (context.phase !== "cylon") return 0;
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "explosive-rounds",
    );
    return has ? 2 : 0;
  },
});

// BSG2-065 Instant Acclaim — Unit +1 power
register("instant-acclaim", {
  category: "link",
  linkTarget: "unit",
  getPowerModifier(_state, unitStack, _ownerIndex, _context) {
    const has = (unitStack.linkedMissions ?? []).some(
      (m) => getCardDef(m.defId)?.abilityId === "instant-acclaim",
    );
    return has ? 1 : 0;
  },
});

// --- Link Unit: Activated ---

// BSG2-051 Clear Your Heads — Commit: exhaust target mission
register("clear-your-heads", {
  category: "link",
  linkTarget: "unit",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution"],
    getTargets(state, _playerIndex, _sourceId) {
      // Target any face-up mission (persistent or in alert)
      const targets: string[] = [];
      for (const p of state.players) {
        for (const stack of p.zones.alert) {
          const top = stack.cards[0];
          if (!top?.faceUp) continue;
          const def = getCardDef(top.defId);
          if (def?.type === "mission") targets.push(top.instanceId);
        }
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, sourceId, targetId, log) {
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      if (targetId) {
        // Exhaust the target mission
        for (const p of state.players) {
          for (const stack of p.zones.alert) {
            if (stack.cards[0]?.instanceId === targetId) {
              stack.exhausted = true;
              log.push("Clear Your Heads: exhausted target mission.");
              return;
            }
          }
        }
      }
    },
  },
});

// BSG2-081 Trust The Lords Of Kobol — Commit: skip mystic reveal, target unit gets +X power
register("trust-the-lords", {
  category: "link",
  linkTarget: "unit",
  activation: {
    cost: "commit-unit",
    usableIn: ["execution", "challenge"],
    getTargets(state, playerIndex, _sourceId) {
      // Target any of your units
      const targets: string[] = [];
      const player = state.players[playerIndex];
      for (const stack of player.zones.alert) {
        const top = stack.cards[0];
        if (top?.faceUp) targets.push(top.instanceId);
      }
      return targets.length > 0 ? targets : [];
    },
    resolve(state, playerIndex, sourceId, targetId, log) {
      // Get mystic value before committing
      const unitStack = findUnitInAnyZone(state.players[playerIndex], sourceId);
      const sourceDef = unitStack ? getCardDef(unitStack.stack.cards[0]?.defId) : undefined;
      const mv = sourceDef?.mysticValue ?? 0;
      commitUnitLocal(state.players[playerIndex], sourceId, log);
      if (targetId) {
        helpers.applyPowerBuff(state, targetId, mv, log);
        log.push(`Trust The Lords: target unit gets +${mv} power (skip mystic reveal).`);
      }
    },
  },
});

// --- Link Unit: Triggered ---

// BSG2-066 Last Word — When this unit defeats a challenger → gain influence = power difference
register("last-word", {
  category: "link",
  linkTarget: "unit",
  onChallengeWin(state, playerIndex, _winnerStack, _loserStack, powerDiff, log, isDefender) {
    if (!isDefender) return; // Only triggers when defending (defeats a challenger)
    state.players[playerIndex].influence += Math.max(0, powerDiff);
    log.push(
      `Last Word: gain ${Math.max(0, powerDiff)} influence from power difference. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// ============================================================
// DISPATCHERS (called by game engine at hook points)
// ============================================================

// --- Resolve-time ---

export function resolveMissionAbility(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  targetId: string | undefined,
  log: LogItem[],
): void {
  const handler = registry.get(abilityId);
  if (!handler?.onResolve) {
    log.push(`Mission resolved (no effect registered for ${abilityId}).`);
    return;
  }
  handler.onResolve(state, playerIndex, targetId, log);
}

export function getMissionResolveTargets(
  abilityId: string,
  state: GameState,
  playerIndex: number,
): string[] | null {
  const handler = registry.get(abilityId);
  return handler?.getResolveTargets?.(state, playerIndex) ?? null;
}

export function canResolveMissionAbility(
  abilityId: string,
  state: GameState,
  playerIndex: number,
): boolean {
  const handler = registry.get(abilityId);
  return handler?.canResolve?.(state, playerIndex) ?? true;
}

export function getMissionCategory(abilityId: string): "one-shot" | "persistent" | "link" {
  const handler = registry.get(abilityId);
  return handler?.category ?? "one-shot";
}

export function getLinkTargetType(abilityId: string): "personnel" | "ship" | "unit" | undefined {
  const handler = registry.get(abilityId);
  return handler?.linkTarget;
}

// --- Passive modifiers ---

export function computeMissionPowerModifier(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
  context: PowerContext,
): number {
  let total = 0;

  // Check persistent missions for power modifiers
  for (const player of state.players) {
    for (const mc of player.zones.persistentMissions ?? []) {
      if (!mc.faceUp) continue; // exhausted missions don't contribute
      const def = getCardDef(mc.defId);
      if (!def?.abilityId) continue;
      const handler = registry.get(def.abilityId);
      if (handler?.getPowerModifier) {
        total += handler.getPowerModifier(state, unitStack, ownerIndex, context);
      }
    }
  }

  // Check linked missions on this unit
  for (const mc of unitStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.getPowerModifier) {
      total += handler.getPowerModifier(state, unitStack, ownerIndex, context);
    }
  }

  return total;
}

/** Itemized mission power modifiers for a unit (for log breakdown). */
export function computeMissionPowerBreakdown(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
  context: PowerContext,
): { source: string; amount: number }[] {
  const items: { source: string; amount: number }[] = [];

  // Persistent missions
  for (const player of state.players) {
    for (const mc of player.zones.persistentMissions ?? []) {
      if (!mc.faceUp) continue;
      const def = getCardDef(mc.defId);
      if (!def?.abilityId) continue;
      const handler = registry.get(def.abilityId);
      if (handler?.getPowerModifier) {
        const mod = handler.getPowerModifier(state, unitStack, ownerIndex, context);
        if (mod !== 0) items.push({ source: helpers.cardName(def), amount: mod });
      }
    }
  }

  // Linked missions on this unit
  for (const mc of unitStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.getPowerModifier) {
      const mod = handler.getPowerModifier(state, unitStack, ownerIndex, context);
      if (mod !== 0) items.push({ source: helpers.cardName(def) + " (linked)", amount: mod });
    }
  }

  return items;
}

export function computeMissionFleetDefenseModifier(state: GameState): number {
  let total = 0;
  for (const player of state.players) {
    for (const mc of player.zones.persistentMissions ?? []) {
      if (!mc.faceUp) continue;
      const def = getCardDef(mc.defId);
      if (!def?.abilityId) continue;
      const handler = registry.get(def.abilityId);
      if (handler?.fleetDefenseModifier) {
        total += handler.fleetDefenseModifier;
      }
    }
  }
  return total;
}

export function computeMissionCylonThreatBonus(state: GameState): number {
  let total = 0;
  for (const player of state.players) {
    for (const mc of player.zones.persistentMissions ?? []) {
      if (!mc.faceUp) continue;
      const def = getCardDef(mc.defId);
      if (!def?.abilityId) continue;
      const handler = registry.get(def.abilityId);
      if (handler?.cylonThreatBonus) {
        total += handler.cylonThreatBonus;
      }
    }
  }
  return total;
}

export function getMissionKeywordGrants(
  state: GameState,
  unitStack: UnitStack,
  ownerIndex: number,
): Keyword[] {
  const grants: Keyword[] = [];

  // From persistent missions
  for (const player of state.players) {
    for (const mc of player.zones.persistentMissions ?? []) {
      if (!mc.faceUp) continue;
      const def = getCardDef(mc.defId);
      if (!def?.abilityId) continue;
      const handler = registry.get(def.abilityId);
      if (handler?.getKeywordGrants) {
        grants.push(...handler.getKeywordGrants(state, unitStack, ownerIndex));
      }
    }
  }

  // From linked missions on this unit
  for (const mc of unitStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.getKeywordGrants) {
      grants.push(...handler.getKeywordGrants(state, unitStack, ownerIndex));
    }
  }

  return grants;
}

export function canLinkedUnitChallenge(_state: GameState, unitStack: UnitStack): boolean {
  for (const mc of unitStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.canChallenge === false) return false;
  }
  return true;
}

// --- Activated abilities ---

export function getMissionActivationActions(
  state: GameState,
  playerIndex: number,
  context: "execution" | "challenge" | "cylon-challenge",
): ValidAction[] {
  const actions: ValidAction[] = [];
  const player = state.players[playerIndex];

  // Check persistent missions with activations
  for (const mc of player.zones.persistentMissions ?? []) {
    if (!mc.faceUp) continue;
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (!handler?.activation) continue;
    if (!handler.activation.usableIn.includes(context)) continue;
    const targets = handler.activation.getTargets?.(state, playerIndex, mc.instanceId);
    if (targets !== undefined && targets !== null && targets.length === 0) continue;
    actions.push({
      type: "playAbility",
      description: `${def.subtitle ?? def.abilityId}: ${def.abilityText?.substring(0, 60)}...`,
      cardDefId: def.id,
      selectableInstanceIds: targets ?? undefined,
      targetInstanceId: mc.instanceId,
    });
  }

  // Check linked missions with activations
  for (const zone of [player.zones.alert]) {
    for (const stack of zone) {
      if (stack.exhausted) continue;
      const top = stack.cards[0];
      if (!top?.faceUp) continue;
      for (const mc of stack.linkedMissions ?? []) {
        const def = getCardDef(mc.defId);
        if (!def?.abilityId) continue;
        const handler = registry.get(def.abilityId);
        if (!handler?.activation) continue;
        if (!handler.activation.usableIn.includes(context)) continue;
        if (
          handler.activation.cost === "commit-unit" ||
          handler.activation.cost === "commit-exhaust-unit"
        ) {
          // Source unit must be alert and not exhausted
          const targets = handler.activation.getTargets?.(state, playerIndex, top.instanceId);
          if (targets !== undefined && targets !== null && targets.length === 0) continue;
          actions.push({
            type: "playAbility",
            description: `${def.subtitle ?? def.abilityId} (linked): ${def.abilityText?.substring(0, 60)}...`,
            cardDefId: def.id,
            selectableInstanceIds: targets ?? undefined,
            targetInstanceId: top.instanceId,
          });
        }
      }
    }
  }

  return actions;
}

export function resolveMissionActivation(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  sourceId: string,
  targetId: string | undefined,
  log: LogItem[],
): void {
  const handler = registry.get(abilityId);
  handler?.activation?.resolve(state, playerIndex, sourceId, targetId, log);
}

// --- Trigger dispatchers ---

export function fireMissionOnEventPlay(
  state: GameState,
  playerIndex: number,
  log: LogItem[],
): void {
  // Check all persistent missions for onEventPlay
  for (const [, handler] of registry) {
    if (handler.onEventPlay) {
      handler.onEventPlay(state, playerIndex, log);
    }
  }
}

export function fireMissionOnReadyPhaseStart(state: GameState, log: LogItem[]): void {
  for (let pi = 0; pi < state.players.length; pi++) {
    for (const [, handler] of registry) {
      if (handler.onReadyPhaseStart) {
        handler.onReadyPhaseStart(state, pi, log);
      }
    }
  }
}

export function adjustMysticForMissions(
  state: GameState,
  playerIndex: number,
  value: number,
  cardDef: CardDef,
): number {
  let adjusted = value;
  for (const [, handler] of registry) {
    if (handler.onMysticReveal) {
      adjusted = handler.onMysticReveal(state, playerIndex, adjusted, cardDef);
    }
  }
  return adjusted;
}

export function interceptMissionDefeat(
  state: GameState,
  playerIndex: number,
  unitType: "personnel" | "ship",
  unitInstanceId: string,
  log: LogItem[],
): boolean {
  // Check persistent missions first
  for (const [, handler] of registry) {
    if (handler.interceptDefeat) {
      if (handler.interceptDefeat(state, playerIndex, unitType, unitInstanceId, log)) {
        return true;
      }
    }
  }
  return false;
}

export function cleanupLinkedMissions(
  state: GameState,
  playerIndex: number,
  unitStack: UnitStack,
  log: LogItem[],
): void {
  const linked = unitStack.linkedMissions ?? [];
  if (linked.length === 0) return;

  // Fire onLinkedUnitLeavePlay triggers
  for (const mc of linked) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.onLinkedUnitLeavePlay) {
      handler.onLinkedUnitLeavePlay(state, playerIndex, unitStack.cards[0]?.instanceId ?? "", log);
    }
  }

  // Move all linked missions to their owner's discard
  for (const mc of linked) {
    state.players[playerIndex].discard.push(mc);
    const def = getCardDef(mc.defId);
    if (def) log.push(`Linked mission ${helpers.cardName(def)} goes to discard.`);
  }
  unitStack.linkedMissions = [];
}

export function fireMissionOnCylonDefeat(
  state: GameState,
  playerIndex: number,
  unitInstanceId: string,
  log: LogItem[],
): void {
  const player = state.players[playerIndex];
  // Check linked missions on the winning unit
  for (const zone of [player.zones.alert, player.zones.reserve]) {
    for (const stack of zone) {
      if (stack.cards[0]?.instanceId !== unitInstanceId) continue;
      for (const mc of stack.linkedMissions ?? []) {
        const def = getCardDef(mc.defId);
        if (!def?.abilityId) continue;
        const handler = registry.get(def.abilityId);
        if (handler?.onCylonThreatDefeat) {
          handler.onCylonThreatDefeat(state, playerIndex, unitInstanceId, log);
        }
      }
    }
  }
}

export function fireMissionOnChallengeWin(
  state: GameState,
  playerIndex: number,
  winnerStack: UnitStack,
  loserStack: UnitStack,
  powerDiff: number,
  log: LogItem[],
  isDefender: boolean,
): void {
  for (const mc of winnerStack.linkedMissions ?? []) {
    const def = getCardDef(mc.defId);
    if (!def?.abilityId) continue;
    const handler = registry.get(def.abilityId);
    if (handler?.onChallengeWin) {
      handler.onChallengeWin(
        state,
        playerIndex,
        winnerStack,
        loserStack,
        powerDiff,
        log,
        isDefender,
      );
    }
  }
}

export function fireMissionOnDraw(
  state: GameState,
  playerIndex: number,
  drawCount: number,
  log: LogItem[],
): void {
  for (const [, handler] of registry) {
    if (handler.onDraw) {
      handler.onDraw(state, playerIndex, drawCount, log);
    }
  }
}

// --- Special game rule modifiers ---

export function checkMissionOverlayPrevention(
  state: GameState,
  playerIndex: number,
  unitDef: CardDef,
): boolean {
  for (const [, handler] of registry) {
    if (handler.preventOverlay) {
      if (handler.preventOverlay(state, playerIndex, unitDef)) return true;
    }
  }
  return false;
}

export function getMissionChallengeCost(
  state: GameState,
  challengerIndex: number,
  defenderIndex: number,
): number {
  let total = 0;
  for (const [, handler] of registry) {
    if (handler.challengeCostModifier) {
      total += handler.challengeCostModifier(state, challengerIndex, defenderIndex);
    }
  }
  return total;
}

// --- Link target helper ---

export function hasIndependentTribunal(unitStack: UnitStack): boolean {
  return (unitStack.linkedMissions ?? []).some(
    (m) => getCardDef(m.defId)?.abilityId === "independent-tribunal",
  );
}

// ============================================================
// Pending Choice Handlers
// ============================================================

registerPendingChoice("pulling-rank-1", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Commit ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    for (const p of state.players) {
      const found = findUnitInZone(p.zones.alert, chosenCard.instanceId);
      if (found) {
        p.zones.alert.splice(found.index, 1);
        p.zones.reserve.push(found.stack);
        const def = getCardDef(chosenCard.defId);
        log.push(`Pulling Rank: committed ${helpers.cardName(def)}.`);
        break;
      }
    }
    const remaining: CardInstance[] = [];
    for (const p of state.players) {
      for (const st of p.zones.alert) {
        const top = st.cards[0];
        if (!top?.faceUp) continue;
        const d = getCardDef(top.defId);
        if (d?.type === "personnel") remaining.push(top);
      }
    }
    if (remaining.length > 0) {
      state.pendingChoice = {
        type: "pulling-rank-2",
        playerIndex,
        cards: remaining,
      };
    }
  },
  aiDecide(choice, choiceActions, state, playerIndex) {
    const oppIdx = 1 - playerIndex;
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      if (!choiceActions[i].cardDefId) continue;
      const card = choice.cards[i];
      const isOpp = card && !!findUnitInAnyZone(state.players[oppIdx], card.instanceId);
      const def = getCardDef(choiceActions[i].cardDefId!);
      const score = (def?.power ?? 0) + (isOpp ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("pulling-rank-2", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Commit ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "No second target" });
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    if (choiceIndex >= choice.cards.length) {
      log.push("Pulling Rank: no second target.");
    } else {
      const chosenCard = choice.cards[choiceIndex];
      if (chosenCard) {
        for (const p of state.players) {
          const found = findUnitInZone(p.zones.alert, chosenCard.instanceId);
          if (found) {
            p.zones.alert.splice(found.index, 1);
            p.zones.reserve.push(found.stack);
            const def = getCardDef(chosenCard.defId);
            log.push(`Pulling Rank: committed ${helpers.cardName(def)}.`);
            break;
          }
        }
      }
    }
  },
  aiDecide(choice, choiceActions, state, playerIndex) {
    const oppIdx = 1 - playerIndex;
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      if (!choiceActions[i].cardDefId) continue;
      const card = choice.cards[i];
      const isOpp = card && !!findUnitInAnyZone(state.players[oppIdx], card.instanceId);
      const def = getCardDef(choiceActions[i].cardDefId!);
      const score = (def?.power ?? 0) + (isOpp ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("assassination-source", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Commit+exhaust ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const found = findUnitInZone(player.zones.alert, chosenCard.instanceId);
    if (found) {
      found.stack.exhausted = true;
      player.zones.alert.splice(found.index, 1);
      player.zones.reserve.push(found.stack);
      const def = getCardDef(chosenCard.defId);
      log.push(`Assassination: ${helpers.cardName(def)} committed and exhausted.`);
    }
    const targets: CardInstance[] = [];
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (const st of zone) {
          const top = st.cards[0];
          if (!top?.faceUp) continue;
          const d = getCardDef(top.defId);
          if (d?.type === "personnel") targets.push(top);
        }
      }
    }
    if (targets.length > 0) {
      state.pendingChoice = {
        type: "assassination-target",
        playerIndex,
        cards: targets,
      };
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const pow = def?.power ?? 0;
        if (pow < bestPow) {
          bestPow = pow;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("assassination-target", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Defeat ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      if (findUnitInAnyZone(p, chosenCard.instanceId)) {
        const def = getCardDef(chosenCard.defId);
        helpers.defeatUnit(p, chosenCard.instanceId, log, state, pi);
        log.push(`Assassination: defeated ${helpers.cardName(def)}.`);
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

registerPendingChoice("arrow-of-apollo-search", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Take ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const deckIdx = player.deck.findIndex((c) => c.instanceId === chosenCard.instanceId);
    if (deckIdx >= 0) {
      player.deck.splice(deckIdx, 1);
      player.hand.push(chosenCard);
      const def = getCardDef(chosenCard.defId);
      log.push(`Arrow Of Apollo: took ${helpers.cardName(def)} from deck.`);
    }
    for (let j = player.deck.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
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

registerPendingChoice("life-has-a-melody-search", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Take ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "Take nothing" });
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    if (choiceIndex >= choice.cards.length) {
      log.push("Life Has A Melody: chose not to take a card.");
    } else {
      const chosenCard = choice.cards[choiceIndex];
      if (chosenCard) {
        const deckIdx = player.deck.findIndex((c) => c.instanceId === chosenCard.instanceId);
        if (deckIdx >= 0) {
          player.deck.splice(deckIdx, 1);
          player.hand.push(chosenCard);
          const def = getCardDef(chosenCard.defId);
          log.push(`Life Has A Melody: took ${helpers.cardName(def)} from deck.`);
        }
      }
    }
    for (let j = player.deck.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
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

registerPendingChoice("hunt-for-tylium-hand", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: helpers.cardName(def),
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const stacks = player.zones.resourceStacks;
    if (stacks.length === 0) return;
    // Let player choose which resource stack to supply
    state.pendingChoice = {
      type: "hunt-for-tylium-stack",
      playerIndex: choice.playerIndex,
      cards: stacks.map((s) => s.topCard),
      context: { handInstanceId: chosenCard.instanceId },
    };
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestMystic = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const mystic = def?.mysticValue ?? 0;
        if (mystic < bestMystic) {
          bestMystic = mystic;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("hunt-for-tylium-stack", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const defId = choice.cards[i].defId;
      const def = cardRegistry[defId];
      const baseDef = helpers.bases[defId];
      const name = def ? helpers.cardName(def) : (baseDef?.title ?? defId);
      actions.push({
        type: "makeChoice",
        description: `Supply to ${name}`,
        cardDefId: defId,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const handInstanceId = ctx.handInstanceId as string;
    const handIdx = player.hand.findIndex((c) => c.instanceId === handInstanceId);
    if (handIdx < 0) return;
    const stack = player.zones.resourceStacks[choiceIndex];
    if (!stack) return;
    const [card] = player.hand.splice(handIdx, 1);
    card.faceUp = false;
    stack.supplyCards.push(card);
    const cardDef = getCardDef(card.defId);
    const stackDefId = stack.topCard.defId;
    const stackDef = cardRegistry[stackDefId];
    const stackBaseDef = helpers.bases[stackDefId];
    const stackName = stackDef ? helpers.cardName(stackDef) : (stackBaseDef?.title ?? stackDefId);
    log.push(`Hunt For Tylium: played ${helpers.cardName(cardDef)} as supply under ${stackName}.`);
  },
  aiDecide(_choice, choiceActions) {
    return Math.floor(Math.random() * choiceActions.length);
  },
});

registerPendingChoice("meet-new-boss-hand", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Exchange ${helpers.cardName(def)} from hand`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const handDef = getCardDef(chosenCard.defId);
    const handPower = handDef?.power ?? 0;
    const fieldMatches: CardInstance[] = [];
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const st of zone) {
        const top = st.cards[0];
        if (!top?.faceUp) continue;
        const d = getCardDef(top.defId);
        if (d?.type === "personnel" && (d.power ?? 0) === handPower) {
          fieldMatches.push(top);
        }
      }
    }
    if (fieldMatches.length > 0) {
      state.pendingChoice = {
        type: "meet-new-boss-field",
        playerIndex,
        cards: fieldMatches,
        context: { handInstanceId: chosenCard.instanceId },
      };
    } else {
      log.push("Meet The New Boss: no matching personnel in play.");
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("meet-new-boss-field", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Exchange with ${helpers.cardName(def)} in play`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, _state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const handInstanceId = ctx.handInstanceId as string;
    const handIdx = player.hand.findIndex((c) => c.instanceId === handInstanceId);
    if (handIdx < 0) return;
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const st of zone) {
        if (st.cards[0]?.instanceId === chosenCard.instanceId) {
          const handCard = player.hand.splice(handIdx, 1)[0];
          const playCards = st.cards.splice(0, st.cards.length);
          st.cards.push(handCard);
          for (const c of playCards) player.hand.push(c);
          const handDef = getCardDef(handCard.defId);
          const playDef = getCardDef(chosenCard.defId);
          log.push(
            `Meet The New Boss: exchanged ${helpers.cardName(handDef)} with ${helpers.cardName(playDef)}.`,
          );
          return;
        }
      }
    }
  },
  aiDecide() {
    return 0;
  },
});

registerPendingChoice("article-23", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Sacrifice ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "Lose 2 influence" });
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const remainingPlayers = (ctx.remainingPlayers as number[]) ?? [];
    if (choiceIndex < choice.cards.length) {
      const chosenCard = choice.cards[choiceIndex];
      if (chosenCard) {
        const found = findUnitInAnyZone(player, chosenCard.instanceId);
        if (found) {
          helpers.defeatUnit(player, chosenCard.instanceId, log, state, playerIndex);
          log.push(`Article 23: Player ${playerIndex + 1} sacrifices a personnel.`);
        }
      }
    } else {
      helpers.applyInfluenceLoss(state, playerIndex, 2, log, helpers.bases);
      log.push(`Article 23: Player ${playerIndex + 1} loses 2 influence.`);
    }
    if (remainingPlayers.length > 0) {
      const nextPlayer = remainingPlayers[0];
      const nextRemaining = remainingPlayers.slice(1);
      const nextP = state.players[nextPlayer];
      const nextPersonnel: CardInstance[] = [];
      for (const zone of [nextP.zones.alert, nextP.zones.reserve]) {
        for (const st of zone) {
          const top = st.cards[0];
          if (!top?.faceUp) continue;
          const d = getCardDef(top.defId);
          if (d?.type === "personnel") nextPersonnel.push(top);
        }
      }
      state.pendingChoice = {
        type: "article-23",
        playerIndex: nextPlayer,
        cards: nextPersonnel,
        context: { remainingPlayers: nextRemaining },
      };
    }
  },
  aiDecide(_choice, choiceActions) {
    if (choiceActions.length <= 1) return 0;
    let cheapestIdx = 0;
    let cheapestPow = Infinity;
    for (let i = 0; i < choiceActions.length - 1; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const pow = def?.power ?? 0;
        if (pow < cheapestPow) {
          cheapestPow = pow;
          cheapestIdx = i;
        }
      }
    }
    return cheapestIdx;
  },
});

registerPendingChoice("prophetic-visions-arrange", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Put ${helpers.cardName(def)} on top`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    const otherCard = choice.cards[1 - choiceIndex];
    const opIdx = ctx.opponentIndex as number;
    const opp = state.players[opIdx];
    if (chosenCard && otherCard) {
      opp.deck.unshift(chosenCard);
      opp.deck.push(otherCard);
      const chosenDef = getCardDef(chosenCard.defId);
      const otherDef = getCardDef(otherCard.defId);
      log.push(
        `Prophetic Visions: ${helpers.cardName(chosenDef)} on top, ${helpers.cardName(otherDef)} on bottom.`,
      );
    }
  },
  aiDecide(_choice, choiceActions) {
    let worstIdx = 0;
    let worstMystic = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = getCardDef(defId);
        const mystic = def?.mysticValue ?? 0;
        if (mystic < worstMystic) {
          worstMystic = mystic;
          worstIdx = i;
        }
      }
    }
    return worstIdx;
  },
});

// --- Critical Component: Player chooses which resource stack to exhaust ---
registerPendingChoice("critical-component-stack", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (const card of choice.cards) {
      const baseDef = helpers.bases[card.defId];
      const cardDef = baseDef ? null : getCardDef(card.defId);
      const name = baseDef ? baseDef.title : cardDef ? helpers.cardName(cardDef) : "Resource stack";
      actions.push({
        type: "makeChoice",
        description: `Exhaust ${name} stack`,
        cardDefId: card.defId,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const stackIndices = ((choice.context ?? {}) as Record<string, unknown>)
      .stackIndices as number[];
    const stackIdx = stackIndices[choiceIndex];
    const player = state.players[playerIndex];
    if (stackIdx != null && player.zones.resourceStacks[stackIdx]) {
      player.zones.resourceStacks[stackIdx].exhausted = true;
    }
    player.extraActionsRemaining = (player.extraActionsRemaining ?? 0) + 1;
    player.costReduction = { persuasion: 2, logistics: 2, security: 2 };
    log.push("Critical Component: extra action granted, next card costs 2 less.");
  },
  aiDecide() {
    return 0; // AI picks first eligible stack
  },
});
