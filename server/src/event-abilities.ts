// ============================================================
// Event Abilities Registry (Open/Closed Principle)
// ============================================================
// Each event card's effect is registered here by abilityId.
// Game engine calls dispatchers; adding new events requires
// only a new register() call — no engine changes needed.
// ============================================================

import type {
  LogItem,
  GameState,
  PlayerState,
  CardDef,
  BaseCardDef,
  UnitStack,
  CardInstance,
  ValidAction,
} from "@bsg/shared";
import { registerPendingChoice } from "./pending-choice-registry.js";

// ============================================================
// Handler Interface
// ============================================================

export interface EventAbilityHandler {
  /** Where this event can be played */
  playableIn: ("execution" | "challenge" | "cylon-challenge")[];

  /** Extra requirements beyond cost (e.g., must control Cylon personnel) */
  canPlay?(state: GameState, playerIndex: number): boolean;

  /** Valid target instanceIds. null = no target needed. */
  getTargets?(
    state: GameState,
    playerIndex: number,
    context: "execution" | "challenge" | "cylon-challenge",
  ): string[] | null;

  /** Custom prompt for target selection (default: "Select target for <card>") */
  targetPrompt?: string;

  /** Resolve the event effect */
  resolve(
    state: GameState,
    playerIndex: number,
    targetId: string | undefined,
    log: LogItem[],
  ): void;
}

// ============================================================
// Game Engine Helpers (injected to avoid circular imports)
// ============================================================

export interface EventGameHelpers {
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
  revealMysticValue(state: GameState, playerIndex: number, log: LogItem[]): number;
  bases: Record<string, BaseCardDef>;
}

let helpers: EventGameHelpers;

export function setEventGameHelpers(h: EventGameHelpers): void {
  helpers = h;
}

// ============================================================
// Card Registry (injected from game engine)
// ============================================================

let cardRegistry: Record<string, CardDef> = {};

export function setEventAbilityCardRegistry(cards: Record<string, CardDef>): void {
  cardRegistry = cards;
}

// ============================================================
// Registry
// ============================================================

const registry = new Map<string, EventAbilityHandler>();

function register(abilityId: string, handler: EventAbilityHandler): void {
  registry.set(abilityId, handler);
}

// ============================================================
// Local Helpers
// ============================================================

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
      const def = helpers.getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? helpers.cardName(def) : "Unit"} committed.`);
    }
    return true;
  }
  return false;
}

function exhaustUnitLocal(player: PlayerState, instanceId: string): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && !found.stack.exhausted) {
    found.stack.exhausted = true;
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
      const def = helpers.getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? helpers.cardName(def) : "Unit"} readied.`);
    }
    return true;
  }
  return false;
}

function restoreUnitLocal(player: PlayerState, instanceId: string): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && found.stack.exhausted) {
    found.stack.exhausted = false;
    return true;
  }
  return false;
}

function getAllUnits(state: GameState): {
  player: PlayerState;
  playerIndex: number;
  stack: UnitStack;
  zone: "alert" | "reserve";
  instanceId: string;
}[] {
  const results: {
    player: PlayerState;
    playerIndex: number;
    stack: UnitStack;
    zone: "alert" | "reserve";
    instanceId: string;
  }[] = [];
  for (let pi = 0; pi < state.players.length; pi++) {
    const p = state.players[pi];
    for (const stack of p.zones.alert) {
      if (stack.cards[0])
        results.push({
          player: p,
          playerIndex: pi,
          stack,
          zone: "alert",
          instanceId: stack.cards[0].instanceId,
        });
    }
    for (const stack of p.zones.reserve) {
      if (stack.cards[0])
        results.push({
          player: p,
          playerIndex: pi,
          stack,
          zone: "reserve",
          instanceId: stack.cards[0].instanceId,
        });
    }
  }
  return results;
}

function getAllAlertUnits(player: PlayerState): string[] {
  return player.zones.alert
    .filter((s) => s.cards[0] && !s.exhausted)
    .map((s) => s.cards[0].instanceId);
}

function pLabel(playerIndex: number, state?: GameState): string {
  return state?.playerNames?.[playerIndex as 0 | 1] ?? `Player ${playerIndex + 1}`;
}

function getUnitDef(stack: UnitStack): CardDef | null {
  if (!stack.cards[0]) return null;
  return cardRegistry[stack.cards[0].defId] ?? null;
}

function getTargetUnitDef(state: GameState, instanceId: string): CardDef | null {
  for (const u of getAllUnits(state)) {
    if (u.instanceId === instanceId) return getUnitDef(u.stack);
  }
  return null;
}

function hasTrait(def: CardDef, trait: string): boolean {
  return def.traits?.includes(trait as import("@bsg/shared").Trait) ?? false;
}

function shuffle<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function sacrificeUnit(player: PlayerState, instanceId: string, log: LogItem[]): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (!found) return false;
  const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
  zone.splice(found.index, 1);
  const def = getUnitDef(found.stack);
  log.push(`${def ? helpers.cardName(def) : "Unit"} is sacrificed.`);
  for (const card of found.stack.cards) {
    player.discard.push(card);
  }
  return true;
}

function returnToHand(player: PlayerState, instanceId: string, log: LogItem[]): boolean {
  const found = findUnitInAnyZone(player, instanceId);
  if (!found) return false;
  const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
  zone.splice(found.index, 1);
  for (const card of found.stack.cards) {
    player.hand.push(card);
  }
  return true;
}

// ============================================================
// 1. POWER BUFFS (15 events)
// ============================================================

// BSG1-027 Fire Support: Target unit +2 power
register("fire-support", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    const targets: string[] = [];
    for (const u of getAllUnits(state)) {
      targets.push(u.instanceId);
    }
    return targets.length > 0 ? targets : [];
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Fire Support: target unit gets +2 power.");
  },
});

// BSG1-028 Fury: Target unit +X power (X = card's mystic value)
register("fury", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (!owner) return;
    const def = getUnitDef(owner.stack);
    if (!def) return;
    const x = def.mysticValue ?? 0;
    helpers.applyPowerBuff(state, targetId, x, log);
    log.push(`Fury: target unit gets +${x} power (mystic value).`);
  },
});

// BSG1-019 Cylon Missile Battery: Target Cylon unit +2 power
register("cylon-missile-battery", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target Cylon unit",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && hasTrait(d, "Cylon");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Cylon Missile Battery: target Cylon unit gets +2 power.");
  },
});

// BSG1-038 Power of Prayer: Reveal mystic, target +X power
register("power-of-prayer", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const mystic = helpers.revealMysticValue(state, playerIndex, log);
    helpers.applyPowerBuff(state, targetId, mystic, log);
    log.push(`Power of Prayer: target unit gets +${mystic} power.`);
  },
});

// BSG1-039 Presidential Candidate: Target defending Politician +2 power
register("presidential-candidate", {
  playableIn: ["challenge"],
  getTargets(state) {
    if (!state.challenge?.defenderInstanceId) return [];
    const owner = findUnitOwner(state, state.challenge.defenderInstanceId);
    if (!owner) return [];
    const def = getUnitDef(owner.stack);
    if (!def || !hasTrait(def, "Politician")) return [];
    return [state.challenge.defenderInstanceId];
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Presidential Candidate: defending Politician gets +2 power.");
  },
});

// BSG1-053 Winning Hand: Target challenging personnel +2 power
register("winning-hand", {
  playableIn: ["challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge) return [];
    const owner = findUnitOwner(state, state.challenge.challengerInstanceId);
    if (!owner) return [];
    const def = getUnitDef(owner.stack);
    if (!def || def.type !== "personnel") return [];
    if (owner.playerIndex !== playerIndex) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Winning Hand: challenging personnel gets +2 power.");
  },
});

// BSG1-055 You Gave Yourself Over: Target Civilian unit +2 power
register("you-gave-yourself-over", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target Civilian unit",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && hasTrait(d, "Civilian");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("You Gave Yourself Over: target Civilian unit gets +2 power.");
  },
});

// BSG2-009 Concentrated Firepower: Target unit +X (X = supply cards in largest stack)
register("concentrated-firepower", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    let maxSupply = 0;
    for (const stack of player.zones.resourceStacks) {
      if (stack.supplyCards.length > maxSupply) maxSupply = stack.supplyCards.length;
    }
    helpers.applyPowerBuff(state, targetId, maxSupply, log);
    log.push(`Concentrated Firepower: target unit gets +${maxSupply} power.`);
  },
});

// BSG2-010 Covering Fire: "Commit a unit you control. Target other unit gets +2 power."
register("covering-fire", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  canPlay(state, playerIndex) {
    return state.players[playerIndex].zones.alert.some((s) => !s.exhausted && s.cards[0]);
  },
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Log the target
    const targetDef = getTargetUnitDef(state, targetId);
    if (targetDef) {
      log.push(`Covering Fire targets ${helpers.cardName(targetDef)}.`);
    }
    // Find eligible units to commit (not the target)
    const eligible = player.zones.alert.filter(
      (s) => !s.exhausted && s.cards[0] && s.cards[0].instanceId !== targetId,
    );
    if (eligible.length === 0) return;
    const cards = eligible.map((s) => s.cards[0]);
    state.pendingChoice = {
      type: "covering-fire-commit",
      playerIndex,
      cards,
      context: { targetId },
      prompt: "Covering Fire — choose a unit to commit for protection",
    };
  },
});

// BSG2-012 Cylon Surprise: Target Cylon Machine +2 power
register("cylon-surprise", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target Cylon Machine unit",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && hasTrait(d, "Cylon") && hasTrait(d, "Machine");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Cylon Surprise: target Cylon Machine gets +2 power.");
  },
});

// BSG2-023 Lest We Forget: Target unit +2 vs Cylon threat + draw 1
register("lest-we-forget", {
  playableIn: ["cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Lest We Forget: target unit gets +2 power vs Cylon threat.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-031 Special Delivery: Target personnel +1 power + Scramble + draw 1
register("special-delivery", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 1, log);
    // Grant Scramble keyword
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryKeywordGrants) owner.player.temporaryKeywordGrants = {};
      const existing = owner.player.temporaryKeywordGrants[targetId] ?? [];
      if (!existing.includes("Scramble")) existing.push("Scramble");
      owner.player.temporaryKeywordGrants[targetId] = existing;
    }
    log.push("Special Delivery: target personnel gets +1 power and Scramble.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-033 Strafing Run: Target ship +1 power + Strafe + draw 1
register("strafing-run", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target ship",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "ship";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 1, log);
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryKeywordGrants) owner.player.temporaryKeywordGrants = {};
      const existing = owner.player.temporaryKeywordGrants[targetId] ?? [];
      if (!existing.includes("Strafe")) existing.push("Strafe");
      owner.player.temporaryKeywordGrants[targetId] = existing;
    }
    log.push("Strafing Run: target ship gets +1 power and Strafe.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-034 Strange Wingman: Target Fighter +X (X = Cylon ships controlled)
register("strange-wingman", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const stack of [...player.zones.alert, ...player.zones.reserve]) {
      const d = getUnitDef(stack);
      if (d && hasTrait(d, "Fighter")) targets.push(stack.cards[0].instanceId);
    }
    return targets;
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    let cylonShips = 0;
    for (const stack of [...player.zones.alert, ...player.zones.reserve]) {
      const d = getUnitDef(stack);
      if (d && d.type === "ship" && hasTrait(d, "Cylon")) cylonShips++;
    }
    helpers.applyPowerBuff(state, targetId, cylonShips, log);
    log.push(`Strange Wingman: target Fighter gets +${cylonShips} power.`);
  },
});

// BSG2-035 Swearing In: Target Politician +2 power
register("swearing-in", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target Politician",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && hasTrait(d, "Politician");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Swearing In: target Politician gets +2 power.");
  },
});

// ============================================================
// 2. POWER DEBUFFS (4 events)
// ============================================================

// BSG1-036 Outmaneuvered: Target ship -2 power
register("outmaneuvered", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target ship",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "ship";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, -2, log);
    log.push("Outmaneuvered: target ship gets -2 power.");
  },
});

// BSG1-052 Vision of Serpents: Target personnel -2 power
register("vision-of-serpents", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, -2, log);
    log.push("Vision of Serpents: target personnel gets -2 power.");
  },
});

// BSG1-054 Wounded in Action: Target undefended challenger -2 power
register("wounded-in-action", {
  playableIn: ["challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge || state.challenge.defenderInstanceId) return [];
    // Must target the challenger and they must be challenging YOU
    if (state.challenge.defenderPlayerIndex !== playerIndex) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    helpers.applyPowerBuff(state, targetId, -2, log);
    log.push("Wounded in Action: undefended challenger gets -2 power.");
  },
});

// BSG2-044 Vulnerable Supplies: Target opposing unit -X (X = opponent's bare assets)
register("vulnerable-supplies", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state, playerIndex) {
    const opp = 1 - playerIndex;
    return getAllUnits(state)
      .filter((u) => u.playerIndex === opp)
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (!owner) return;
    let bareAssets = 0;
    for (const stack of owner.player.zones.resourceStacks) {
      if (stack.supplyCards.length === 0) bareAssets++; // just the asset, no supply cards
    }
    helpers.applyPowerBuff(state, targetId, -bareAssets, log);
    log.push(`Vulnerable Supplies: target unit gets -${bareAssets} power.`);
  },
});

// ============================================================
// 3. UNIT STATE MANAGEMENT (10 events)
// ============================================================

// BSG1-015 Condition One: Ready target unit
register("condition-one", {
  playableIn: ["execution"],
  getTargets(state, playerIndex) {
    // Target any reserve face-up unit (any player)
    const targets: string[] = [];
    for (const p of state.players) {
      for (const s of p.zones.reserve) {
        if (s.cards[0] && !s.exhausted) targets.push(s.cards[0].instanceId);
      }
    }
    return targets;
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (readyUnitLocal(p, targetId, log)) {
        return;
      }
    }
  },
});

// BSG1-016 Condition Two: Commit target unit
register("condition-two", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target alert unit",
  getTargets(state) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const s of p.zones.alert) {
        if (s.cards[0]) targets.push(s.cards[0].instanceId);
      }
    }
    return targets;
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (commitUnitLocal(p, targetId, log)) {
        return;
      }
    }
  },
});

// BSG1-022 Dissension: Exhaust all reserve cards (all players)
register("dissension", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    for (const p of state.players) {
      for (const s of p.zones.reserve) {
        s.exhausted = true;
      }
    }
    log.push("Dissension: all reserve cards exhausted.");
  },
});

// BSG1-023 Distraction: "Commit a personnel you control. Commit and exhaust target unit."
register("distraction", {
  playableIn: ["execution", "challenge"],
  canPlay(state, playerIndex) {
    return state.players[playerIndex].zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted;
    });
  },
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => u.zone === "alert")
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Find eligible personnel to commit (not the target)
    const personnel = player.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted && s.cards[0]?.instanceId !== targetId;
    });
    if (personnel.length === 0) return;
    const cards = personnel.map((s) => s.cards[0]);
    state.pendingChoice = {
      type: "distraction-commit",
      playerIndex,
      cards,
      context: { targetId },
      prompt: "Distraction — choose a personnel to commit",
    };
  },
});

// BSG1-033 Military Coup: "Exhaust a personnel you control. Exhaust target opponent's personnel."
register("military-coup", {
  playableIn: ["execution"],
  canPlay(state, playerIndex) {
    return (
      state.players[playerIndex].zones.alert.some((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel" && !s.exhausted;
      }) ||
      state.players[playerIndex].zones.reserve.some((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel" && !s.exhausted;
      })
    );
  },
  getTargets(state, playerIndex) {
    const opp = 1 - playerIndex;
    return getAllUnits(state)
      .filter((u) => u.playerIndex === opp && !u.stack.exhausted)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Find eligible own personnel to exhaust
    const ownPersonnel = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted;
    });
    if (ownPersonnel.length === 0) return;
    const cards = ownPersonnel.map((s) => s.cards[0]);
    state.pendingChoice = {
      type: "military-coup-exhaust",
      playerIndex,
      cards,
      context: { targetId },
      prompt: "Military Coup — choose a personnel to exhaust",
    };
  },
});

// BSG1-043 Sneak Attack: Commit all Fighters
register("sneak-attack", {
  playableIn: ["execution", "challenge"],
  resolve(state, _playerIndex, _targetId, log) {
    for (const p of state.players) {
      const toCommit = p.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && hasTrait(d, "Fighter");
      });
      for (const s of toCommit) {
        commitUnitLocal(p, s.cards[0].instanceId, log);
      }
    }
  },
});

// BSG2-014 Determination: Restore target unit
register("determination", {
  playableIn: ["execution"],
  targetPrompt: "Select target exhausted unit",
  getTargets(state) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.exhausted && s.cards[0]) targets.push(s.cards[0].instanceId);
      }
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (restoreUnitLocal(p, targetId)) {
        log.push("Determination: target unit restored.");
        return;
      }
    }
  },
});

// BSG2-025 Massive Assault: Ready all Capital Ships and Fighters
register("massive-assault", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (const p of state.players) {
      const toReady = p.zones.reserve.filter((s) => {
        if (s.exhausted) return false;
        const d = getUnitDef(s);
        return d && (hasTrait(d, "Capital Ship") || hasTrait(d, "Fighter"));
      });
      for (const s of toReady) {
        readyUnitLocal(p, s.cards[0].instanceId, log);
      }
    }
  },
});

// BSG2-038 To the Victor: Exhaust target personnel
register("to-the-victor", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => !u.stack.exhausted)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (exhaustUnitLocal(p, targetId)) {
        log.push("To the Victor: target personnel exhausted.");
        return;
      }
    }
  },
});

// BSG1-021 Decoys: "Commit any number of units you control. Target unit gets +2 power for each unit committed."
register("decoys", {
  playableIn: ["execution", "challenge"],
  canPlay(state, playerIndex) {
    return state.players[playerIndex].zones.alert.some((s) => !s.exhausted && s.cards[0]);
  },
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Count how many eligible units can be committed
    const eligible = player.zones.alert.filter(
      (s) => !s.exhausted && s.cards[0] && s.cards[0].instanceId !== targetId,
    );
    if (eligible.length === 0) return;
    log.push("Decoys: Choose how many units to commit.");
    state.pendingChoice = {
      type: "decoys-count",
      playerIndex,
      cards: [],
      context: { targetId, maxCommit: eligible.length },
      prompt: "Decoys — choose how many units to commit",
    };
  },
});

// ============================================================
// 4. OPPONENT-CHOICE EVENTS (7 events)
// ============================================================

// BSG1-024 Downed Pilot: Opponent: commit ship OR sacrifice personnel
register("downed-pilot", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    const alertShips = oppPlayer.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    const allPersonnel = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel";
    });
    if (alertShips.length === 0 && allPersonnel.length === 0) {
      log.push(`Downed Pilot: ${pLabel(opp, state)} has no ships or personnel.`);
      return;
    }
    // Build choice cards: alert ships (commit) + all personnel (sacrifice)
    const choiceCards: CardInstance[] = [];
    for (const s of alertShips) choiceCards.push(s.cards[0]);
    for (const s of allPersonnel) choiceCards.push(s.cards[0]);
    state.pendingChoice = {
      type: "downed-pilot-choice",
      playerIndex: opp,
      cards: choiceCards,
      context: { shipCount: alertShips.length },
      prompt: "Downed Pilot — commit a ship or sacrifice a personnel",
    };
  },
});

// BSG1-025 Endless Task: Target player chooses one — commit or exhaust a unit
register("endless-task", {
  playableIn: ["execution"],
  canPlay(state, _playerIndex) {
    return state.players.some(
      (p) =>
        p.zones.alert.some((s) => s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]),
    );
  },
  resolve(state, playerIndex, _targetId, _log) {
    state.pendingChoice = {
      type: "endless-task-target",
      playerIndex,
      cards: [],
      prompt: "Endless Task — choose a player to target",
    };
  },
});

// BSG1-029 Grounded: Target opponent chooses one — commit a ship OR commit all personnel
register("grounded", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    const alertShips = oppPlayer.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    const alertPersonnel = oppPlayer.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel";
    });
    if (alertShips.length === 0 && alertPersonnel.length === 0) return;
    if (alertShips.length === 0) {
      // Must commit all personnel (no choice)
      for (const s of alertPersonnel) commitUnitLocal(oppPlayer, s.cards[0].instanceId, log);
      return;
    }
    if (alertPersonnel.length === 0) {
      // Must commit a ship — fall through to choice prompt
    }
    // Opponent chooses
    state.pendingChoice = {
      type: "grounded-choice",
      playerIndex: opp,
      cards: [],
      context: { shipCount: alertShips.length, personnelCount: alertPersonnel.length },
      prompt: "Grounded — commit a ship or commit all personnel",
    };
  },
});

// BSG1-030 Hangar Deck Fire: Target opponent chooses one — sacrifice ship OR sacrifice supply card
register("hangar-deck-fire", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    const hasSupply = oppPlayer.zones.resourceStacks.some((s) => s.supplyCards.length > 0);
    const ships = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (!hasSupply && ships.length === 0) {
      log.push(`Hangar Deck Fire: ${pLabel(opp, state)} has nothing to sacrifice.`);
      return;
    }
    if (!hasSupply) {
      // Must sacrifice a ship — opponent picks which
      state.pendingChoice = {
        type: "hangar-deck-fire-ship",
        playerIndex: opp,
        cards: ships.map((s) => s.cards[0]),
        prompt: "Hangar Deck Fire — choose a ship to sacrifice",
      };
      return;
    }
    if (ships.length === 0) {
      // Must sacrifice supply — auto-resolve (supply cards aren't meaningfully different)
      for (const stack of oppPlayer.zones.resourceStacks) {
        if (stack.supplyCards.length > 0) {
          const supply = stack.supplyCards.pop()!;
          oppPlayer.discard.push(supply);
          log.push(`Hangar Deck Fire: ${pLabel(opp, state)} sacrifices a supply card.`);
          return;
        }
      }
      return;
    }
    // Both options available — opponent chooses
    state.pendingChoice = {
      type: "hangar-deck-fire-choice",
      playerIndex: opp,
      cards: [],
      prompt: "Hangar Deck Fire — sacrifice a ship or a supply card",
    };
  },
});

// BSG1-034 Network Hacking: Each player chooses one — commit a Cylon OR commit all ships
register("network-hacking", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    // Chain: player 0 chooses first, then player 1
    networkHackingForPlayer(state, 0, log);
  },
});

function networkHackingForPlayer(state: GameState, pi: number, log?: LogItem[]): void {
  if (pi >= state.players.length) return;
  const p = state.players[pi];
  const cylons = p.zones.alert.filter((s) => {
    const d = getUnitDef(s);
    return d && hasTrait(d, "Cylon");
  });
  const ships = p.zones.alert.filter((s) => {
    const d = getUnitDef(s);
    return d && d.type === "ship";
  });
  if (cylons.length === 0 && ships.length === 0) {
    // Nothing to do for this player, move to next
    networkHackingForPlayer(state, pi + 1, log);
    return;
  }
  if (cylons.length === 0) {
    // Must commit all ships (no choice)
    for (const s of ships) commitUnitLocal(p, s.cards[0].instanceId, log);
    networkHackingForPlayer(state, pi + 1, log);
    return;
  }
  // Player has a real choice (commit a Cylon or commit all ships)
  state.pendingChoice = {
    type: "network-hacking-choice",
    playerIndex: pi,
    cards: [],
    context: { nextPlayer: pi + 1 },
    prompt: "Network Hacking — commit a Cylon or commit all ships",
  };
}

// BSG1-041 Setback: Target player chooses one — exhaust alert unit OR exhaust reserve unit
register("setback", {
  playableIn: ["execution"],
  canPlay(state, _playerIndex) {
    // Playable if any player has a non-exhausted unit
    return state.players.some(
      (p) =>
        p.zones.alert.some((s) => !s.exhausted && s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]),
    );
  },
  resolve(state, playerIndex, _targetId, _log) {
    // Create pending choice: pick which player to target
    state.pendingChoice = {
      type: "setback-target",
      playerIndex,
      cards: [],
      prompt: "Setback — choose a player to target",
    };
  },
});

// BSG1-045 Still No Contact: Opponent: commit personnel OR sacrifice personnel
register("still-no-contact", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    const alertPersonnel = oppPlayer.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel";
    });
    const allPersonnel = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel";
    });
    if (allPersonnel.length === 0) {
      log.push(`Still No Contact: ${pLabel(opp, state)} has no personnel.`);
      return;
    }
    // Build choice cards: alert personnel (commit) + all personnel (sacrifice)
    const choiceCards: CardInstance[] = [];
    for (const s of alertPersonnel) choiceCards.push(s.cards[0]);
    for (const s of allPersonnel) choiceCards.push(s.cards[0]);
    state.pendingChoice = {
      type: "still-no-contact-choice",
      playerIndex: opp,
      cards: choiceCards,
      context: { commitCount: alertPersonnel.length },
      prompt: "Still No Contact — commit a personnel or sacrifice a personnel",
    };
  },
});

// ============================================================
// 5. UNIT DEFEAT / REMOVAL (5 events)
// ============================================================

// BSG1-011 Angry: Commit+exhaust own personnel → defeat target personnel
register("angry", {
  playableIn: ["execution"],
  canPlay(state, playerIndex) {
    return state.players[playerIndex].zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted;
    });
  },
  resolve(state, playerIndex, _targetId, _log) {
    const player = state.players[playerIndex];
    const ownPersonnel = player.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted;
    });
    if (ownPersonnel.length === 0) return;
    state.pendingChoice = {
      type: "angry-commit",
      playerIndex,
      cards: ownPersonnel.map((s) => s.cards[0]),
      prompt: "Angry — choose a personnel you control to commit and exhaust",
    };
  },
});

registerPendingChoice("angry-commit", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (const card of choice.cards) {
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      actions.push({
        type: "makeChoice",
        description: `Commit & exhaust ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    // Commit and exhaust the chosen personnel
    const idx = player.zones.alert.findIndex(
      (s) => s.cards[0]?.instanceId === chosenCard.instanceId,
    );
    if (idx >= 0) {
      const stack = player.zones.alert[idx];
      player.zones.alert.splice(idx, 1);
      stack.exhausted = true;
      player.zones.reserve.push(stack);
    }
    const ownDef = helpers.getCardDef(chosenCard.defId);
    log.push(`Angry: ${ownDef ? helpers.cardName(ownDef) : "personnel"} committed and exhausted.`);
    // Now pick a personnel to defeat (any player)
    const allPersonnel = getAllUnits(state).filter((u) => {
      const d = getUnitDef(u.stack);
      return d && d.type === "personnel";
    });
    if (allPersonnel.length === 0) return;
    state.pendingChoice = {
      type: "angry-defeat",
      playerIndex,
      cards: allPersonnel.map((u) => u.stack.cards[0]),
      context: { ownerIndices: allPersonnel.map((u) => u.playerIndex) },
      prompt: "Angry — choose a personnel to defeat",
    };
  },
  aiDecide(choice, _choiceActions, _state, _playerIndex) {
    // AI picks cheapest own personnel
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choice.cards.length; i++) {
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow < bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("angry-defeat", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const ownerIndices = ((choice.context ?? {}) as Record<string, unknown>)
      .ownerIndices as number[];
    for (let i = 0; i < choice.cards.length; i++) {
      const card = choice.cards[i];
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      const ownerName = pLabel(ownerIndices?.[i] ?? 0, state);
      actions.push({
        type: "makeChoice",
        description: `Defeat ${ownerName}'s ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const owner = findUnitOwner(state, chosenCard.instanceId);
    if (owner) {
      helpers.defeatUnit(owner.player, chosenCard.instanceId, log, state, owner.playerIndex);
    }
  },
  aiDecide(choice, _choiceActions, state, playerIndex) {
    // AI defeats strongest opponent personnel
    let bestIdx = 0;
    let bestPow = -1;
    for (let i = 0; i < choice.cards.length; i++) {
      const owner = findUnitOwner(state, choice.cards[i].instanceId);
      if (!owner || owner.playerIndex === playerIndex) continue;
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow > bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

// BSG1-048 Suicide Bomber: "Sacrifice a Cylon personnel you control. Defeat two target personnel."
register("suicide-bomber", {
  playableIn: ["execution"],
  canPlay(state, playerIndex) {
    return [
      ...state.players[playerIndex].zones.alert,
      ...state.players[playerIndex].zones.reserve,
    ].some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && hasTrait(d, "Cylon");
    });
  },
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Find eligible Cylon personnel to sacrifice
    const cylonPersonnel = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && hasTrait(d, "Cylon");
    });
    if (cylonPersonnel.length === 0) return;
    const cards = cylonPersonnel.map((s) => s.cards[0]);
    state.pendingChoice = {
      type: "suicide-bomber-cylon",
      playerIndex,
      cards,
      context: { targetId },
      prompt: "Suicide Bomber — choose a Cylon personnel to sacrifice",
    };
  },
});

// BSG1-050 Them or Us: Sacrifice ship → defeat target personnel
register("them-or-us", {
  playableIn: ["execution"],
  canPlay(state, playerIndex) {
    return [
      ...state.players[playerIndex].zones.alert,
      ...state.players[playerIndex].zones.reserve,
    ].some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
  },
  resolve(state, playerIndex, _targetId, _log) {
    const player = state.players[playerIndex];
    const ships = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (ships.length === 0) return;
    state.pendingChoice = {
      type: "them-or-us-ship",
      playerIndex,
      cards: ships.map((s) => s.cards[0]),
      prompt: "Them or Us — choose a ship to sacrifice",
    };
  },
});

// BSG2-022 Left Behind: Defeat all units
register("left-behind", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const allIds = [
        ...p.zones.alert.map((s) => s.cards[0]?.instanceId).filter(Boolean),
        ...p.zones.reserve.map((s) => s.cards[0]?.instanceId).filter(Boolean),
      ] as string[];
      for (const id of allIds) {
        helpers.defeatUnit(p, id, log, state, pi);
      }
    }
    log.push("Left Behind: all units defeated.");
  },
});

// BSG2-024 Like a Ghost Town: Defeat all Civilian units
register("like-a-ghost-town", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const civilians = [...p.zones.alert, ...p.zones.reserve]
        .filter((s) => {
          const d = getUnitDef(s);
          return d && hasTrait(d, "Civilian");
        })
        .map((s) => s.cards[0]?.instanceId)
        .filter(Boolean) as string[];
      for (const id of civilians) {
        helpers.defeatUnit(p, id, log, state, pi);
      }
    }
    log.push("Like a Ghost Town: all Civilian units defeated.");
  },
});

// ============================================================
// 6. CARD MOVEMENT / BOUNCE (5 events)
// ============================================================

// BSG1-012 Bingo Fuel: Return target alert ship to owner's hand
register("bingo-fuel", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target alert ship",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => u.zone === "alert" && getUnitDef(u.stack)?.type === "ship")
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (returnToHand(p, targetId, log)) {
        log.push("Bingo Fuel: target ship returned to hand.");
        return;
      }
    }
  },
});

// BSG1-042 Sick Bay: Return target alert personnel to owner's hand
register("sick-bay", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target alert personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => u.zone === "alert" && getUnitDef(u.stack)?.type === "personnel")
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      if (returnToHand(p, targetId, log)) {
        log.push("Sick Bay: target personnel returned to hand.");
        return;
      }
    }
  },
});

// BSG1-047 Stranded: Shuffle target reserve personnel into owner's deck
register("stranded", {
  playableIn: ["execution"],
  targetPrompt: "Select target reserve personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => u.zone === "reserve" && getUnitDef(u.stack)?.type === "personnel")
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInZone(p.zones.reserve, targetId);
      if (found) {
        p.zones.reserve.splice(found.index, 1);
        for (const card of found.stack.cards) {
          p.deck.push(card);
        }
        shuffle(p.deck);
        log.push("Stranded: target reserve personnel shuffled into deck.");
        return;
      }
    }
  },
});

// BSG1-051 Under Arrest: Put target personnel on top of owner's deck
register("under-arrest", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      const found = findUnitInAnyZone(p, targetId);
      if (found) {
        const zone = found.zone === "alert" ? p.zones.alert : p.zones.reserve;
        zone.splice(found.index, 1);
        // Put on top of deck (unshift = top)
        for (const card of found.stack.cards.reverse()) {
          p.deck.unshift(card);
        }
        log.push("Under Arrest: target personnel put on top of deck.");
        return;
      }
    }
  },
});

// BSG1-037 Painful Recovery: Put own Cylon unit on deck → commit+exhaust target personnel
register("painful-recovery", {
  playableIn: ["execution"],
  targetPrompt: "Select target Cylon unit you control to return to deck",
  canPlay(state, playerIndex) {
    return [
      ...state.players[playerIndex].zones.alert,
      ...state.players[playerIndex].zones.reserve,
    ].some((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon") && (d.type === "personnel" || d.type === "ship");
    });
  },
  getTargets(state, playerIndex) {
    // Target a Cylon unit you control
    return [...state.players[playerIndex].zones.alert, ...state.players[playerIndex].zones.reserve]
      .filter((s) => {
        const d = getUnitDef(s);
        return d && hasTrait(d, "Cylon") && (d.type === "personnel" || d.type === "ship");
      })
      .map((s) => s.cards[0].instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Put the chosen Cylon unit on top of its owner's deck
    const found = findUnitInAnyZone(player, targetId);
    if (!found) return;
    const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
    zone.splice(found.index, 1);
    const d = helpers.getCardDef(found.stack.cards[0]?.defId ?? "");
    for (const card of found.stack.cards.reverse()) {
      player.deck.unshift(card);
    }
    log.push(`Painful Recovery: ${helpers.cardName(d)} put on top of deck.`);
    // "If you do" — now pick a personnel to commit+exhaust
    const personnelTargets = getAllUnits(state)
      .filter((u) => {
        const def = getUnitDef(u.stack);
        return def && def.type === "personnel";
      })
      .map((u) => ({ instanceId: u.instanceId, stack: u.stack }));
    if (personnelTargets.length === 0) return;
    const cards = personnelTargets.map((u) => u.stack.cards[0]);
    state.pendingChoice = {
      type: "painful-recovery-personnel",
      playerIndex,
      cards,
      context: {},
      prompt: "Painful Recovery — choose a personnel to commit and exhaust",
    };
  },
});

// ============================================================
// 7. MISSION MANIPULATION (4 events)
// ============================================================

// BSG1-013 Catastrophe: Defeat target persistent mission
register("catastrophe", {
  playableIn: ["execution"],
  targetPrompt: "Select target persistent mission",
  getTargets(state) {
    // Target persistent missions in resource areas and unresolved missions
    const targets: string[] = [];
    for (const p of state.players) {
      // Persistent missions in resource stacks (resolved)
      for (const stack of p.zones.resourceStacks) {
        const def = cardRegistry[stack.topCard.defId];
        if (def && def.type === "mission") targets.push(stack.topCard.instanceId);
      }
      // Unresolved persistent missions in alert/reserve
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.cards[0]) {
          const def = cardRegistry[s.cards[0].defId];
          if (def && def.type === "mission" && def.abilityText?.includes("Persistent")) {
            targets.push(s.cards[0].instanceId);
          }
        }
      }
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    // Search resource stacks for persistent missions
    for (const p of state.players) {
      for (let i = 0; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (stack.topCard.instanceId === targetId) {
          p.zones.resourceStacks.splice(i, 1);
          p.discard.push(stack.topCard);
          for (const card of stack.supplyCards) p.discard.push(card);
          log.push("Catastrophe: persistent mission defeated.");
          return;
        }
      }
      // Also check alert/reserve for unresolved persistent missions
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (let i = 0; i < zone.length; i++) {
          if (zone[i].cards[0]?.instanceId === targetId) {
            const removed = zone.splice(i, 1)[0];
            for (const card of removed.cards) p.discard.push(card);
            log.push("Catastrophe: persistent mission defeated.");
            return;
          }
        }
      }
    }
  },
});

// BSG2-011 Crushing Reality: Exhaust target mission
register("crushing-reality", {
  playableIn: ["execution"],
  targetPrompt: "Select target mission",
  getTargets(state) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.cards[0] && !s.exhausted) {
          const def = cardRegistry[s.cards[0].defId];
          if (def && def.type === "mission") targets.push(s.cards[0].instanceId);
        }
      }
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.cards[0]?.instanceId === targetId) {
          s.exhausted = true;
          log.push("Crushing Reality: target mission exhausted.");
          return;
        }
      }
    }
  },
});

// BSG2-030 Site of Betrayal: Defeat all unresolved missions
register("site-of-betrayal", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        const toRemove: number[] = [];
        for (let i = 0; i < zone.length; i++) {
          if (zone[i].cards[0]) {
            const def = cardRegistry[zone[i].cards[0].defId];
            if (def && def.type === "mission") toRemove.push(i);
          }
        }
        for (let i = toRemove.length - 1; i >= 0; i--) {
          const removed = zone.splice(toRemove[i], 1)[0];
          for (const card of removed.cards) p.discard.push(card);
        }
      }
    }
    log.push("Site of Betrayal: all unresolved missions defeated.");
  },
});

// BSG2-037 This Tribunal Is Over: Defeat target mission
register("this-tribunal", {
  playableIn: ["execution"],
  targetPrompt: "Select target mission",
  getTargets(state) {
    const targets: string[] = [];
    for (const p of state.players) {
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.cards[0]) {
          const def = cardRegistry[s.cards[0].defId];
          if (def && def.type === "mission") targets.push(s.cards[0].instanceId);
        }
      }
    }
    return targets;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        for (let i = 0; i < zone.length; i++) {
          if (zone[i].cards[0]?.instanceId === targetId) {
            const removed = zone.splice(i, 1)[0];
            for (const card of removed.cards) p.discard.push(card);
            log.push("This Tribunal Is Over: target mission defeated.");
            return;
          }
        }
      }
    }
  },
});

// ============================================================
// 8. HAND / DECK MANIPULATION (9 events)
// ============================================================

// BSG1-009 Act of Contrition: "Target opponent reveals hand. Choose and discard a card."
register("act-of-contrition", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    if (oppPlayer.hand.length === 0) {
      log.push(`Act of Contrition: ${pLabel(opp, state)} has no cards in hand.`);
      return;
    }
    const handNames = oppPlayer.hand
      .map((c) => {
        const d = cardRegistry[c.defId];
        return d ? helpers.cardName(d) : "unknown";
      })
      .join(", ");
    log.push(`Act of Contrition: ${pLabel(opp, state)} reveals hand: ${handNames}`);
    state.pendingChoice = {
      type: "act-of-contrition",
      playerIndex,
      cards: [...oppPlayer.hand], // copy of hand cards for choice display
      context: { opponentIndex: opp },
      prompt: "Act of Contrition — choose a card to discard from opponent's hand",
    };
  },
});

// BSG1-010 Advanced Planning: Look at top 5, put one on top, rest on bottom
register("advanced-planning", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    const top5: CardInstance[] = [];
    for (let i = 0; i < 5 && player.deck.length > 0; i++) {
      top5.push(player.deck.shift()!);
    }
    if (top5.length === 0) return;
    if (top5.length === 1) {
      // Only one card — put it back, no choice needed
      player.deck.unshift(top5[0]);
      const def = cardRegistry[top5[0].defId];
      log.push(
        `Advanced Planning: only 1 card in deck; ${def ? helpers.cardName(def) : "a card"} stays on top.`,
      );
      return;
    }
    log.push(`Advanced Planning: looking at top ${top5.length} cards…`);
    state.pendingChoice = {
      type: "advanced-planning-choose",
      playerIndex,
      cards: top5,
      prompt: "Advanced Planning — choose a card to put on top of your deck",
    };
  },
});

registerPendingChoice("advanced-planning-choose", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (const card of choice.cards) {
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      actions.push({
        type: "makeChoice",
        description: `Keep ${helpers.cardName(def)} on top`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const kept = choice.cards[choiceIndex];
    if (!kept) return;
    // Put chosen card on top of deck
    player.deck.unshift(kept);
    // Put the rest on bottom
    for (let i = 0; i < choice.cards.length; i++) {
      if (i === choiceIndex) continue;
      player.deck.push(choice.cards[i]);
    }
    state.pendingChoice = undefined;
    const keptDef = helpers.getCardDef(kept.defId);
    log.push(
      `Advanced Planning: kept ${keptDef ? helpers.cardName(keptDef) : "a card"} on top; rest placed on bottom.`,
    );
  },
  aiDecide(choice) {
    // AI picks highest mystic value
    let bestIdx = 0;
    let bestMystic = 0;
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      const mystic = def?.mysticValue ?? 0;
      if (mystic > bestMystic) {
        bestMystic = mystic;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

// BSG1-017 Crackdown: Target opponent discards a card
register("crackdown", {
  playableIn: ["execution", "challenge"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    if (oppPlayer.hand.length === 0) {
      log.push(`Crackdown: ${pLabel(opp, state)} has no cards.`);
      return;
    }
    // Opponent chooses which card to discard
    state.pendingChoice = {
      type: "crackdown-discard",
      playerIndex: opp,
      cards: [...oppPlayer.hand],
      prompt: "Crackdown — choose a card to discard",
    };
  },
});

// BSG1-018 Cylon Computer Virus: All discard hands, redraw starting hand size
register("cylon-computer-virus", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const baseDef = helpers.bases[p.baseDefId];
      const startingHandSize = baseDef?.handSize ?? p.hand.length;
      for (const card of p.hand) {
        p.discard.push(card);
      }
      p.hand = [];
      helpers.drawCards(p, startingHandSize, log, pLabel(pi, state), state, pi);
    }
    log.push("Cylon Computer Virus: all players discarded and redrew (starting hand size).");
  },
});

// BSG1-040 Reformat: "Discard any number of cards from your hand. Draw that many cards."
register("reformat", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    if (player.hand.length === 0) {
      log.push("Reformat: No cards in hand.");
      return;
    }
    log.push("Reformat: Choose how many cards to discard and redraw.");
    state.pendingChoice = {
      type: "reformat-count",
      playerIndex,
      cards: [],
      context: { maxDiscard: player.hand.length },
      prompt: "Reformat — choose how many cards to discard and redraw",
    };
  },
});

// BSG2-020 Full Disclosure: All players reveal hands (informational only)
register("full-disclosure", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const names = state.players[pi].hand
        .map((c) => {
          const d = cardRegistry[c.defId];
          return d ? helpers.cardName(d) : "unknown";
        })
        .join(", ");
      log.push(`Full Disclosure: ${pLabel(pi, state)} reveals: ${names || "(empty hand)"}`);
    }
  },
});

// BSG2-021 Full System Malfunction: Each player discards entire hand
register("full-system-malfunction", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (const p of state.players) {
      for (const card of p.hand) {
        p.discard.push(card);
      }
      p.hand = [];
    }
    log.push("Full System Malfunction: all players discard their hands.");
  },
});

// BSG2-028 Resupply: Draw X (X = supply cards in largest unexhausted stack)
register("resupply", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    let maxSupply = 0;
    for (const stack of player.zones.resourceStacks) {
      if (!stack.exhausted) {
        if (stack.supplyCards.length > maxSupply) maxSupply = stack.supplyCards.length;
      }
    }
    if (maxSupply > 0) {
      helpers.drawCards(player, maxSupply, log, pLabel(playerIndex, state), state, playerIndex);
      log.push(`Resupply: drew ${maxSupply} cards.`);
    } else {
      log.push("Resupply: no supply cards in unexhausted stacks.");
    }
  },
});

// BSG1-035 Networked Computers: All reveal mystics; winner recovers from discard
register("networked-computers", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    let bestPlayer = 0;
    let bestMystic = -1;
    for (let pi = 0; pi < state.players.length; pi++) {
      const mystic = helpers.revealMysticValue(state, pi, log);
      log.push(`Networked Computers: ${pLabel(pi, state)} reveals mystic value ${mystic}.`);
      if (mystic > bestMystic) {
        bestMystic = mystic;
        bestPlayer = pi;
      }
    }
    // Winner picks from discard (auto-pick highest cost card)
    const winner = state.players[bestPlayer];
    if (winner.discard.length > 0) {
      let bestIdx = 0;
      let bestCost = 0;
      for (let i = 0; i < winner.discard.length; i++) {
        const def = cardRegistry[winner.discard[i].defId];
        if (def?.cost) {
          const total = Object.values(def.cost).reduce((a: number, b: number) => a + b, 0);
          if (total > bestCost) {
            bestCost = total;
            bestIdx = i;
          }
        }
      }
      const recovered = winner.discard.splice(bestIdx, 1)[0];
      winner.hand.push(recovered);
      const rDef = cardRegistry[recovered.defId];
      log.push(
        `Networked Computers: ${pLabel(bestPlayer, state)} recovers ${rDef ? helpers.cardName(rDef) : "card"} from discard.`,
      );
    }
  },
});

// ============================================================
// 9. INFLUENCE MANIPULATION (4 events)
// ============================================================

// BSG1-026 Executive Privilege: Prevent all influence loss this phase
register("executive-privilege", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  resolve(state, _playerIndex, _targetId, log) {
    state.preventInfluenceLoss = true;
    log.push("Executive Privilege: all influence loss prevented this phase.");
  },
});

// BSG1-044 Standoff: Prevent all influence gain this phase
register("standoff", {
  playableIn: ["execution", "challenge"],
  resolve(state, _playerIndex, _targetId, log) {
    state.preventInfluenceGain = true;
    log.push("Standoff: all influence gain prevented this phase.");
  },
});

// BSG1-049 Test of Faith: Target player gains 1 influence
register("test-of-faith", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    // In 2-player, target self for gain
    if (!state.preventInfluenceGain) {
      state.players[playerIndex].influence += 1;
    }
    log.push(
      `Test of Faith: ${pLabel(playerIndex, state)} gains 1 influence. (Now ${state.players[playerIndex].influence})`,
    );
  },
});

// BSG1-031 High Stakes Game: All reveal hands; highest mystic total gains 2 influence
register("high-stakes-game", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    let bestTotal = -1;
    const totals: number[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      // Find highest single mystic value in hand
      let maxMystic = 0;
      let count = 0;
      for (const card of p.hand) {
        const def = cardRegistry[card.defId];
        const mv = def?.mysticValue ?? 0;
        if (mv > maxMystic) maxMystic = mv;
        if (mv === maxMystic) count++;
      }
      // "most cards that have the highest mystic values" = count of cards with the max mystic
      totals.push(count);
      if (count > bestTotal) bestTotal = count;
      log.push(
        `High Stakes Game: ${pLabel(pi, state)} reveals hand. ${count} cards with highest mystic value.`,
      );
    }
    for (let pi = 0; pi < state.players.length; pi++) {
      if (totals[pi] === bestTotal && !state.preventInfluenceGain) {
        state.players[pi].influence += 2;
        log.push(
          `High Stakes Game: ${pLabel(pi, state)} gains 2 influence. (Now ${state.players[pi].influence})`,
        );
      }
    }
  },
});

// ============================================================
// 10. CHALLENGE MANIPULATION (7 events)
// ============================================================

// BSG1-014 Channel the Lords of Kobol: Double mystic reveal (ERRATA)
register("channel-lords", {
  playableIn: ["execution", "challenge"],
  resolve(state, playerIndex, _targetId, log) {
    if (state.challenge) {
      state.challenge.doubleMysticReveal = playerIndex;
    }
    log.push("Channel the Lords of Kobol: next mystic value will be doubled.");
  },
});

// BSG1-046 Stims: Target challenging Pilot +4; exhaust at challenge end
register("stims", {
  playableIn: ["challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge) return [];
    if (state.challenge.challengerPlayerIndex !== playerIndex) return [];
    const owner = findUnitOwner(state, state.challenge.challengerInstanceId);
    if (!owner) return [];
    const def = getUnitDef(owner.stack);
    if (!def || !hasTrait(def, "Pilot")) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId || !state.challenge) return;
    helpers.applyPowerBuff(state, targetId, 4, log);
    state.challenge.exhaustAtChallengeEnd = targetId;
    log.push("Stims: challenging Pilot gets +4 power; will be exhausted at challenge end.");
  },
});

// BSG2-015 Discourage Pursuit: Exhaust defender; immune + defeat challenger on win
register("discourage-pursuit", {
  playableIn: ["challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge?.defenderInstanceId) return [];
    if (state.challenge.defenderPlayerIndex !== playerIndex) return [];
    const owner = findUnitOwner(state, state.challenge.defenderInstanceId);
    if (!owner) return [];
    const def = getUnitDef(owner.stack);
    if (!def || def.type !== "personnel") return [];
    return [state.challenge.defenderInstanceId];
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId || !state.challenge) return;
    // Exhaust the defender
    exhaustUnitLocal(state.players[playerIndex], targetId);
    state.challenge.defenderImmune = true;
    state.challenge.defeatChallengerOnWin = true;
    log.push(
      "Discourage Pursuit: defender exhausted; immune to defeat. Challenger will be defeated if they win.",
    );
  },
});

// BSG2-029 Showdown: No challenges rest of phase
register("showdown", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    state.noChallenges = true;
    log.push("Showdown: no challenges can be declared this phase.");
  },
});

// BSG2-032 Spot Judgment: Reveal 2 mystic values, choose best
register("spot-judgment", {
  playableIn: ["challenge"],
  resolve(state, playerIndex, _targetId, log) {
    if (state.challenge) {
      state.challenge.selfDoubleMystic = playerIndex;
    }
    log.push("Spot Judgment: next mystic reveal will be doubled (best chosen).");
  },
});

// BSG2-042 ...Sign: During ship challenge, end challenge, both committed
register("sign", {
  playableIn: ["challenge"],
  canPlay(state) {
    if (!state.challenge || !state.challenge.defenderInstanceId) return false;
    const challenger = findUnitOwner(state, state.challenge.challengerInstanceId);
    const defender = findUnitOwner(state, state.challenge.defenderInstanceId);
    if (!challenger || !defender) return false;
    const cDef = getUnitDef(challenger.stack);
    const dDef = getUnitDef(defender.stack);
    return cDef?.type === "ship" && dDef?.type === "ship";
  },
  resolve(state, _playerIndex, _targetId, log) {
    if (!state.challenge) return;
    // Commit both ships
    const challenger = findUnitOwner(state, state.challenge.challengerInstanceId);
    const defender = state.challenge.defenderInstanceId
      ? findUnitOwner(state, state.challenge.defenderInstanceId)
      : null;
    if (challenger) commitUnitLocal(challenger.player, state.challenge.challengerInstanceId, log);
    if (defender) commitUnitLocal(defender.player, state.challenge.defenderInstanceId!, log);
    state.challenge.forceEnd = true;
    log.push("...Sign: challenge ends.");
  },
});

// BSG2-043 Unwelcome Visitor: Target challenging Cylon personnel +4; defeat at end
register("unwelcome-visitor", {
  playableIn: ["challenge"],
  getTargets(state, playerIndex) {
    if (!state.challenge) return [];
    if (state.challenge.challengerPlayerIndex !== playerIndex) return [];
    const owner = findUnitOwner(state, state.challenge.challengerInstanceId);
    if (!owner) return [];
    const def = getUnitDef(owner.stack);
    if (!def || def.type !== "personnel" || !hasTrait(def, "Cylon")) return [];
    return [state.challenge.challengerInstanceId];
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId || !state.challenge) return;
    helpers.applyPowerBuff(state, targetId, 4, log);
    state.challenge.defeatAtChallengeEnd = targetId;
    log.push(
      "Unwelcome Visitor: target Cylon personnel gets +4 power; will be defeated when challenge ends.",
    );
  },
});

// ============================================================
// 11. TRAIT / KEYWORD MODIFICATION (5 events)
// ============================================================

// BSG2-008 Boarding Party: Target ship gains Scramble + draw 1
register("boarding-party", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target ship",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "ship";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryKeywordGrants) owner.player.temporaryKeywordGrants = {};
      const existing = owner.player.temporaryKeywordGrants[targetId] ?? [];
      if (!existing.includes("Scramble")) existing.push("Scramble");
      owner.player.temporaryKeywordGrants[targetId] = existing;
    }
    log.push("Boarding Party: target ship gains Scramble.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-013 Cylons on the Brain: Target personnel gains Cylon trait
register("cylons-on-brain", {
  playableIn: ["execution"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryTraitGrants) owner.player.temporaryTraitGrants = {};
      const existing = owner.player.temporaryTraitGrants[targetId] ?? [];
      if (!existing.includes("Cylon")) existing.push("Cylon");
      owner.player.temporaryTraitGrants[targetId] = existing;
    }
    log.push("Cylons on the Brain: target personnel gains Cylon trait.");
  },
});

// BSG2-017 Everyone's Green: Target Cylon (non-Machine) personnel loses Cylon + draw
register("everyone-green", {
  playableIn: ["execution"],
  targetPrompt: "Select target Cylon personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel" && hasTrait(d, "Cylon") && !hasTrait(d, "Machine");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryTraitRemovals) owner.player.temporaryTraitRemovals = {};
      const existing = owner.player.temporaryTraitRemovals[targetId] ?? [];
      if (!existing.includes("Cylon")) existing.push("Cylon");
      owner.player.temporaryTraitRemovals[targetId] = existing;
    }
    log.push("Everyone's Green: target Cylon personnel loses Cylon trait.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-026 Out of Sight: Target personnel gains Scramble + draw 1
register("out-of-sight", {
  playableIn: ["execution", "challenge"],
  targetPrompt: "Select target personnel",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "personnel";
      })
      .map((u) => u.instanceId);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryKeywordGrants) owner.player.temporaryKeywordGrants = {};
      const existing = owner.player.temporaryKeywordGrants[targetId] ?? [];
      if (!existing.includes("Scramble")) existing.push("Scramble");
      owner.player.temporaryKeywordGrants[targetId] = existing;
    }
    log.push("Out of Sight: target personnel gains Scramble.");
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// BSG2-041 Unexpected...: Target Cylon ship loses Cylon trait
register("unexpected", {
  playableIn: ["execution"],
  targetPrompt: "Select target Cylon ship",
  getTargets(state) {
    return getAllUnits(state)
      .filter((u) => {
        const d = getUnitDef(u.stack);
        return d && d.type === "ship" && hasTrait(d, "Cylon");
      })
      .map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      if (!owner.player.temporaryTraitRemovals) owner.player.temporaryTraitRemovals = {};
      const existing = owner.player.temporaryTraitRemovals[targetId] ?? [];
      if (!existing.includes("Cylon")) existing.push("Cylon");
      owner.player.temporaryTraitRemovals[targetId] = existing;
    }
    log.push("Unexpected...: target Cylon ship loses Cylon trait.");
  },
});

// ============================================================
// 12. CYLON / SPECIAL (8 events)
// ============================================================

// BSG1-020 Cylons Look Like Humans: Each player mills per Cylon count
register("cylons-look-like-humans", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      let cylonCount = 0;
      for (const s of [...p.zones.alert, ...p.zones.reserve]) {
        if (s.cards[0]) {
          const d = cardRegistry[s.cards[0].defId];
          if (
            d &&
            (hasTrait(d, "Cylon") ||
              (d.type === "mission" && d.abilityText?.toLowerCase().includes("cylon")))
          ) {
            cylonCount++;
          }
        }
      }
      for (let i = 0; i < cylonCount && p.deck.length > 0; i++) {
        const milled = p.deck.shift()!;
        p.discard.push(milled);
      }
      if (cylonCount > 0) {
        log.push(`Cylons Look Like Humans: ${pLabel(pi, state)} mills ${cylonCount} cards.`);
      }
    }
  },
});

// BSG1-032 Martial Law: Politicians can't defend this phase
register("martial-law", {
  playableIn: ["execution", "challenge"],
  resolve(state, _playerIndex, _targetId, log) {
    state.politiciansCantDefend = true;
    log.push("Martial Law: Politicians cannot defend this phase.");
  },
});

// BSG2-016 Double Trouble: Extract singular Cylon from unit stack → reserve
register("double-trouble", {
  playableIn: ["execution"],
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const s of [...player.zones.alert, ...player.zones.reserve]) {
      if (s.cards.length > 1) {
        // Look for Cylon cards in the stack (not the top)
        for (let i = 1; i < s.cards.length; i++) {
          const d = cardRegistry[s.cards[i].defId];
          if (d && hasTrait(d, "Cylon") && d.type === "personnel") {
            targets.push(s.cards[i].instanceId);
          }
        }
      }
    }
    return targets;
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    // Find the card in a unit stack and extract it
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        for (let i = 1; i < stack.cards.length; i++) {
          if (stack.cards[i].instanceId === targetId) {
            const extracted = stack.cards.splice(i, 1)[0];
            // Put into reserve as new stack
            player.zones.reserve.push({ cards: [extracted], exhausted: false });
            const d = cardRegistry[extracted.defId];
            log.push(
              `Double Trouble: ${d ? helpers.cardName(d) : "Cylon"} extracted from unit stack to reserve.`,
            );
            return;
          }
        }
      }
    }
  },
});

// BSG2-019 False Sense of Security: Opponent reveals 2 mystic, you choose
register("false-sense-security", {
  playableIn: ["challenge"],
  resolve(state, playerIndex, _targetId, log) {
    if (state.challenge) {
      const opp = 1 - playerIndex;
      state.challenge.opponentDoubleMystic = { controllerIndex: playerIndex, opponentIndex: opp };
    }
    log.push("False Sense of Security: opponent will reveal 2 mystic values; you choose which.");
  },
});

// BSG2-036 There Are Many Copies: Return Cylon personnel from discard to hand
register("there-are-many-copies", {
  playableIn: ["execution"],
  getTargets(state, playerIndex) {
    const player = state.players[playerIndex];
    const targets: string[] = [];
    for (const card of player.discard) {
      const def = cardRegistry[card.defId];
      if (def && def.type === "personnel" && hasTrait(def, "Cylon")) {
        targets.push(card.instanceId);
      }
    }
    return targets;
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    const player = state.players[playerIndex];
    const idx = player.discard.findIndex((c) => c.instanceId === targetId);
    if (idx >= 0) {
      const card = player.discard.splice(idx, 1)[0];
      player.hand.push(card);
      const def = cardRegistry[card.defId];
      log.push(
        `There Are Many Copies: ${def ? helpers.cardName(def) : "Cylon personnel"} returned to hand from discard.`,
      );
    }
  },
});

// BSG2-039 Top Off the Tank: Becomes supply card
register("top-off-tank", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    // The card itself will be added as a supply card to a resource stack
    // We set a flag so game-engine doesn't add to discard
    const player = state.players[playerIndex];
    // Find the largest resource stack to add supply to
    let bestStack = player.zones.resourceStacks[0];
    for (const stack of player.zones.resourceStacks) {
      if (!stack.exhausted && stack.supplyCards.length > (bestStack?.supplyCards.length ?? 0)) {
        bestStack = stack;
      }
    }
    // The actual card instance will be handled by game-engine using skipEventDiscard flag
    state.skipEventDiscard = true;
    log.push("Top Off the Tank: event becomes a supply card.");
  },
});

// BSG2-040 Treacherous Toaster: Target Cylon threat +2 power + draw 1
register("treacherous-toaster", {
  playableIn: ["cylon-challenge"],
  getTargets(state) {
    // Target a Cylon threat
    return state.cylonThreats.map((ct, _i) => ct.card.instanceId).filter(Boolean);
  },
  resolve(state, playerIndex, targetId, log) {
    if (!targetId) return;
    // Find the Cylon threat and buff it
    for (const ct of state.cylonThreats) {
      if (ct.card.instanceId === targetId) {
        const def = cardRegistry[ct.card.defId];
        const currentPower = def?.cylonThreat ?? 0;
        // Apply buff via cylon threat modifier
        const player = state.players[playerIndex];
        if (!player.temporaryCylonThreatMods) player.temporaryCylonThreatMods = {};
        player.temporaryCylonThreatMods[targetId] =
          (player.temporaryCylonThreatMods[targetId] ?? 0) + 2;
        log.push(`Treacherous Toaster: Cylon threat gets +2 power (now ${currentPower + 2}).`);
        break;
      }
    }
    helpers.drawCards(
      state.players[playerIndex],
      1,
      log,
      pLabel(playerIndex, state),
      state,
      playerIndex,
    );
  },
});

// ============================================================
// 13. Effect Immunity
// ============================================================

// BSG2-007 Anti-Radiation Dosage — "Target unit can't be the target of effects that change its power."
register("anti-radiation", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (targetId) {
      if (!state.effectImmunity) state.effectImmunity = {};
      state.effectImmunity[targetId] = "power";
      log.push(
        "Anti-Radiation Dosage: target unit is immune to power-changing effects this phase.",
      );
    }
  },
});

// BSG2-018 Fallout Shelter — "Target unit can't be the target of effects."
register("fallout-shelter", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(state, _playerIndex, targetId, log) {
    if (targetId) {
      if (!state.effectImmunity) state.effectImmunity = {};
      state.effectImmunity[targetId] = "all";
      log.push("Fallout Shelter: target unit is immune to all effects this phase.");
    }
  },
});

// BSG2-027 Raiding Farms — "Defeat target asset that has no supply cards."
register("raiding-farms", {
  playableIn: ["execution"],
  canPlay(state, playerIndex) {
    // Must exist at least one asset with no supply cards (in any player's resource area)
    for (const p of state.players) {
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        if (p.zones.resourceStacks[i].supplyCards.length === 0) return true;
      }
    }
    return false;
  },
  getTargets(state) {
    const ids: string[] = [];
    for (const p of state.players) {
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        const stack = p.zones.resourceStacks[i];
        if (stack.supplyCards.length === 0) {
          ids.push(stack.topCard.instanceId);
        }
      }
    }
    return ids;
  },
  resolve(state, _playerIndex, targetId, log) {
    if (!targetId) return;
    for (const p of state.players) {
      for (let i = 1; i < p.zones.resourceStacks.length; i++) {
        if (p.zones.resourceStacks[i].topCard.instanceId === targetId) {
          const removed = p.zones.resourceStacks.splice(i, 1)[0];
          p.discard.push(removed.topCard);
          log.push("Raiding Farms: defeated target asset.");
          return;
        }
      }
    }
    log.push("Raiding Farms: target asset not found.");
  },
});

// ============================================================
// Dispatchers (exported for game-engine)
// ============================================================

export function resolveEventAbility(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  targetId: string | undefined,
  log: LogItem[],
): void {
  const handler = registry.get(abilityId);
  if (!handler) {
    log.push(`Event ability "${abilityId}" not found in registry.`);
    return;
  }
  handler.resolve(state, playerIndex, targetId, log);
}

export function getEventTargets(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  context: "execution" | "challenge" | "cylon-challenge",
): string[] | null {
  const handler = registry.get(abilityId);
  if (!handler?.getTargets) return null;
  const targets = handler.getTargets(state, playerIndex, context);
  if (!targets || !state.effectImmunity) return targets;
  // Filter out units with "all" effect immunity (Fallout Shelter)
  return targets.filter((id) => state.effectImmunity?.[id] !== "all");
}

export function getEventTargetPrompt(abilityId: string): string | undefined {
  return registry.get(abilityId)?.targetPrompt;
}

export function canPlayEvent(
  abilityId: string,
  state: GameState,
  playerIndex: number,
  context: "execution" | "challenge" | "cylon-challenge" = "execution",
): boolean {
  const handler = registry.get(abilityId);
  if (!handler) return true; // unknown events are always playable
  if (handler.canPlay && !handler.canPlay(state, playerIndex)) return false;
  // Targeted events with no valid targets are unplayable
  if (handler.getTargets) {
    const targets = getEventTargets(abilityId, state, playerIndex, context);
    if (targets && targets.length === 0) return false;
  }
  return true;
}

export function isEventPlayableIn(
  abilityId: string,
  context: "execution" | "challenge" | "cylon-challenge",
): boolean {
  const handler = registry.get(abilityId);
  if (!handler) return true;
  return handler.playableIn.includes(context);
}

// ============================================================
// Pending Choice Handlers
// ============================================================

registerPendingChoice("godfrey-reveal", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Put ${helpers.cardName(def)} on deck`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const oppIdx = ctx.opponentIndex as number;
    const opp = state.players[oppIdx];
    const def = helpers.getCardDef(chosenCard.defId);
    const handIdx = opp.hand.findIndex((c) => c.instanceId === chosenCard.instanceId);
    if (handIdx >= 0) {
      opp.hand.splice(handIdx, 1);
      opp.deck.unshift(chosenCard);
      log.push(`Godfrey: ${helpers.cardName(def)} put on top of opponent's deck.`);
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestCost = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
        const cost = def?.cost
          ? Object.values(def.cost).reduce((a: number, b: number) => a + b, 0)
          : 0;
        if (cost > bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("act-of-contrition", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Discard ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const oppIdx = ctx.opponentIndex as number;
    const opp = state.players[oppIdx];
    const def = helpers.getCardDef(chosenCard.defId);
    const handIdx = opp.hand.findIndex((c) => c.instanceId === chosenCard.instanceId);
    if (handIdx >= 0) {
      opp.hand.splice(handIdx, 1);
      opp.discard.push(chosenCard);
      log.push(`Act of Contrition: ${helpers.cardName(def)} discarded from opponent's hand.`);
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestCost = -1;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
        const cost = def?.cost
          ? Object.values(def.cost).reduce((a: number, b: number) => a + b, 0)
          : 0;
        if (cost > bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("covering-fire-commit", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
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
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    helpers.commitUnit(player, chosenCard.instanceId, log);
    const targetId = ctx.targetId as string;
    if (targetId) {
      helpers.applyPowerBuff(state, targetId, 2, log);
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("distraction-commit", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
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
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    helpers.commitUnit(player, chosenCard.instanceId, log);
    const targetId = ctx.targetId as string;
    if (targetId) {
      for (const p of state.players) {
        const found = findUnitInAnyZone(p, targetId);
        if (found && found.zone === "alert") {
          p.zones.alert.splice(found.index, 1);
          found.stack.exhausted = true;
          p.zones.reserve.push(found.stack);
          log.push("Distraction: target unit committed and exhausted.");
          break;
        }
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("military-coup-exhaust", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Exhaust ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const found = findUnitInAnyZone(player, chosenCard.instanceId);
    if (found) found.stack.exhausted = true;
    const ownDef = helpers.getCardDef(chosenCard.defId);
    log.push(`Military Coup: ${helpers.cardName(ownDef)} exhausted.`);
    const targetId = ctx.targetId as string;
    if (targetId) {
      for (const p of state.players) {
        const tgt = findUnitInAnyZone(p, targetId);
        if (tgt) {
          tgt.stack.exhausted = true;
          log.push("Military Coup: target opponent personnel exhausted.");
          break;
        }
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("painful-recovery-personnel", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
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
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    for (const p of state.players) {
      const tgt = findUnitInAnyZone(p, chosenCard.instanceId);
      if (tgt && tgt.zone === "alert") {
        p.zones.alert.splice(tgt.index, 1);
        tgt.stack.exhausted = true;
        p.zones.reserve.push(tgt.stack);
        log.push("Painful Recovery: target personnel committed and exhausted.");
        break;
      } else if (tgt) {
        tgt.stack.exhausted = true;
        log.push("Painful Recovery: target personnel exhausted.");
        break;
      }
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("suicide-bomber-cylon", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Sacrifice ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const found = findUnitInAnyZone(player, chosenCard.instanceId);
    if (found) {
      const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
      zone.splice(found.index, 1);
      for (const card of found.stack.cards) player.discard.push(card);
      const d = helpers.getCardDef(chosenCard.defId);
      log.push(`Suicide Bomber: ${helpers.cardName(d)} sacrificed.`);
    }
    const targetId = ctx.targetId as string;
    if (targetId) {
      for (let pi = 0; pi < state.players.length; pi++) {
        const p = state.players[pi];
        if (findUnitInAnyZone(p, targetId)) {
          helpers.defeatUnit(p, targetId, log, state, pi);
          break;
        }
      }
    }
    const secondTargets: CardInstance[] = [];
    const secondOwnerIndices: number[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      for (const zn of [p.zones.alert, p.zones.reserve]) {
        for (const stack of zn) {
          const tc = stack.cards[0];
          if (tc?.faceUp && tc.instanceId !== targetId) {
            const d = helpers.getCardDef(tc.defId);
            if (d?.type === "personnel") {
              secondTargets.push(tc);
              secondOwnerIndices.push(pi);
            }
          }
        }
      }
    }
    if (secondTargets.length > 0) {
      state.pendingChoice = {
        type: "suicide-bomber-target2",
        playerIndex,
        cards: secondTargets,
        context: { ownerIndices: secondOwnerIndices },
        prompt: "Suicide Bomber — choose a second personnel to defeat",
      };
    }
  },
  aiDecide(_choice, choiceActions) {
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("suicide-bomber-target2", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const ownerIndices = ((choice.context ?? {}) as Record<string, unknown>)
      .ownerIndices as number[];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        const ownerName = pLabel(ownerIndices?.[i] ?? 0, state);
        actions.push({
          type: "makeChoice",
          description: `Defeat ${ownerName}'s ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    actions.push({ type: "makeChoice", description: "No second target" });
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    if (choiceIndex >= choice.cards.length) {
      log.push("Suicide Bomber: No second target.");
    } else {
      const chosenCard = choice.cards[choiceIndex];
      if (chosenCard) {
        for (let pi = 0; pi < state.players.length; pi++) {
          const p = state.players[pi];
          if (findUnitInAnyZone(p, chosenCard.instanceId)) {
            helpers.defeatUnit(p, chosenCard.instanceId, log, state, pi);
            log.push("Suicide Bomber: Second personnel defeated.");
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
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

registerPendingChoice("decoys-count", {
  getActions(choice) {
    const maxCommit =
      (((choice.context ?? {}) as Record<string, unknown>).maxCommit as number) ?? 1;
    const actions: ValidAction[] = [];
    for (let i = 1; i <= maxCommit; i++) {
      actions.push({
        type: "makeChoice",
        description: `Commit ${i} unit${i > 1 ? "s" : ""} (+${i * 2} power)`,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, _playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const count = choiceIndex + 1;
    const targetId = ctx.targetId as string;
    const eligible = player.zones.alert.filter(
      (st) => !st.exhausted && st.cards[0] && st.cards[0].instanceId !== targetId,
    );
    eligible.sort((a, b) => {
      const aPow = cardRegistry[a.cards[0].defId]?.power ?? 0;
      const bPow = cardRegistry[b.cards[0].defId]?.power ?? 0;
      return aPow - bPow;
    });
    let committed = 0;
    for (const st of eligible) {
      if (committed >= count) break;
      helpers.commitUnit(player, st.cards[0].instanceId, log);
      committed++;
    }
    if (committed > 0 && targetId) {
      helpers.applyPowerBuff(state, targetId, committed * 2, log);
    }
  },
  aiDecide(_choice, choiceActions) {
    return choiceActions.length - 1;
  },
});

// --- Setback: Step 1 — choose target player ---
registerPendingChoice("setback-target", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const caster = choice.playerIndex;
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const hasUnit =
        p.zones.alert.some((s) => !s.exhausted && s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]);
      if (hasUnit) {
        actions.push({
          type: "makeChoice",
          description: pi === caster ? "Target yourself" : "Target opponent",
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const caster = choice.playerIndex;
    // Build the same player list as getActions to map choiceIndex → playerIndex
    const eligiblePlayers: number[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const hasUnit =
        p.zones.alert.some((s) => !s.exhausted && s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]);
      if (hasUnit) eligiblePlayers.push(pi);
    }
    const targetIdx = eligiblePlayers[choiceIndex] ?? 1 - caster;
    const targetPlayer = state.players[targetIdx];
    // Collect non-exhausted units for the targeted player to choose from
    const units: CardInstance[] = [];
    for (const s of targetPlayer.zones.alert) {
      if (!s.exhausted && s.cards[0]) units.push(s.cards[0]);
    }
    for (const s of targetPlayer.zones.reserve) {
      if (!s.exhausted && s.cards[0]) units.push(s.cards[0]);
    }
    if (units.length === 0) return; // shouldn't happen given canPlay
    // Targeted player chooses which unit to exhaust
    state.pendingChoice = {
      type: "setback-exhaust",
      playerIndex: targetIdx,
      cards: units,
      prompt: "Setback — choose a unit to exhaust",
    };
  },
  aiDecide(_choice, choiceActions) {
    // AI always targets opponent (last action if both are eligible)
    return choiceActions.length - 1;
  },
});

// --- Setback: Step 2 — targeted player chooses unit to exhaust ---
registerPendingChoice("setback-exhaust", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Exhaust ${helpers.cardName(def)}`,
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
      exhaustUnitLocal(p, chosenCard.instanceId);
    }
    const def = helpers.getCardDef(chosenCard.defId);
    log.push(
      `Setback: ${pLabel(playerIndex, state)} exhausts ${def ? helpers.cardName(def) : "unit"}.`,
    );
  },
  aiDecide(_choice, choiceActions) {
    // AI picks lowest-power unit to exhaust
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

// --- Endless Task: Step 1 — choose target player ---
registerPendingChoice("endless-task-target", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const caster = choice.playerIndex;
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const hasUnit =
        p.zones.alert.some((s) => s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]);
      if (hasUnit) {
        actions.push({
          type: "makeChoice",
          description: pi === caster ? "Target yourself" : "Target opponent",
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, _log) {
    const caster = choice.playerIndex;
    const eligiblePlayers: number[] = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const hasUnit =
        p.zones.alert.some((s) => s.cards[0]) ||
        p.zones.reserve.some((s) => !s.exhausted && s.cards[0]);
      if (hasUnit) eligiblePlayers.push(pi);
    }
    const targetIdx = eligiblePlayers[choiceIndex] ?? 1 - caster;
    const targetPlayer = state.players[targetIdx];
    // Collect eligible units: alert can be committed or exhausted, reserve can only be exhausted
    const units: CardInstance[] = [];
    for (const s of targetPlayer.zones.alert) {
      if (s.cards[0]) units.push(s.cards[0]);
    }
    for (const s of targetPlayer.zones.reserve) {
      if (!s.exhausted && s.cards[0]) units.push(s.cards[0]);
    }
    if (units.length === 0) return;
    // Targeted player chooses unit + action
    state.pendingChoice = {
      type: "endless-task-unit",
      playerIndex: targetIdx,
      cards: units,
      prompt: "Endless Task — choose a unit to commit or exhaust",
    };
  },
  aiDecide(_choice, choiceActions) {
    return choiceActions.length - 1; // target opponent
  },
});

// --- Endless Task: Step 2 — targeted player picks unit to commit/exhaust ---
registerPendingChoice("endless-task-unit", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const targetPlayer = state.players[choice.playerIndex];
    for (let i = 0; i < choice.cards.length; i++) {
      const card = choice.cards[i];
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      const name = helpers.cardName(def);
      // Check if unit is in alert (can commit or exhaust) or reserve (exhaust only)
      const inAlert = targetPlayer.zones.alert.some(
        (s) => s.cards[0]?.instanceId === card.instanceId,
      );
      if (inAlert) {
        actions.push({ type: "makeChoice", description: `Commit ${name}`, cardDefId: def.id });
        const stack = targetPlayer.zones.alert.find(
          (s) => s.cards[0]?.instanceId === card.instanceId,
        );
        if (stack && !stack.exhausted) {
          actions.push({ type: "makeChoice", description: `Exhaust ${name}`, cardDefId: def.id });
        }
      } else {
        actions.push({ type: "makeChoice", description: `Exhaust ${name}`, cardDefId: def.id });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    // Rebuild the same action list to map choiceIndex to the right action
    const targetPlayer = state.players[playerIndex];
    const actionList: { instanceId: string; action: "commit" | "exhaust"; name: string }[] = [];
    for (const card of choice.cards) {
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      const name = helpers.cardName(def);
      const inAlert = targetPlayer.zones.alert.some(
        (s) => s.cards[0]?.instanceId === card.instanceId,
      );
      if (inAlert) {
        actionList.push({ instanceId: card.instanceId, action: "commit", name });
        const stack = targetPlayer.zones.alert.find(
          (s) => s.cards[0]?.instanceId === card.instanceId,
        );
        if (stack && !stack.exhausted) {
          actionList.push({ instanceId: card.instanceId, action: "exhaust", name });
        }
      } else {
        actionList.push({ instanceId: card.instanceId, action: "exhaust", name });
      }
    }
    const chosen = actionList[choiceIndex];
    if (!chosen) return;
    if (chosen.action === "commit") {
      commitUnitLocal(targetPlayer, chosen.instanceId, log);
    } else {
      exhaustUnitLocal(targetPlayer, chosen.instanceId);
      log.push(`Endless Task: ${pLabel(playerIndex, state)} exhausts ${chosen.name}.`);
    }
  },
  aiDecide(_choice, choiceActions) {
    // AI prefers exhaust over commit (less impactful), pick first exhaust action
    for (let i = 0; i < choiceActions.length; i++) {
      if (choiceActions[i].description?.startsWith("Exhaust")) return i;
    }
    return 0;
  },
});

// --- Grounded: Opponent chooses commit a ship or commit all personnel ---
registerPendingChoice("grounded-choice", {
  getActions(choice) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const actions: ValidAction[] = [];
    if ((ctx.shipCount as number) > 0) {
      actions.push({ type: "makeChoice", description: "Commit a ship" });
    }
    if ((ctx.personnelCount as number) > 0) {
      actions.push({ type: "makeChoice", description: "Commit all personnel" });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const p = state.players[playerIndex];
    // Rebuild action list to determine what was chosen
    const options: string[] = [];
    if ((ctx.shipCount as number) > 0) options.push("ship");
    if ((ctx.personnelCount as number) > 0) options.push("personnel");
    const chosen = options[choiceIndex];
    if (chosen === "ship") {
      const alertShips = p.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "ship";
      });
      // Pick which ship
      state.pendingChoice = {
        type: "grounded-ship",
        playerIndex,
        cards: alertShips.map((s) => s.cards[0]),
        prompt: "Grounded — choose a ship to commit",
      };
    } else {
      const personnel = p.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel";
      });
      for (const s of personnel) commitUnitLocal(p, s.cards[0].instanceId, log);
    }
  },
  aiDecide(choice) {
    // AI prefers committing one ship over all personnel
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    if ((ctx.shipCount as number) > 0) return 0; // "Commit a ship" is first
    return 0;
  },
});

// --- Grounded: Pick which ship to commit ---
registerPendingChoice("grounded-ship", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
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
    commitUnitLocal(state.players[playerIndex], chosenCard.instanceId, log);
  },
  aiDecide(_choice, choiceActions) {
    // AI commits lowest-power ship
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

// --- Hangar Deck Fire: Opponent chooses sacrifice ship or supply ---
registerPendingChoice("hangar-deck-fire-choice", {
  getActions() {
    return [
      { type: "makeChoice" as const, description: "Sacrifice a ship" },
      { type: "makeChoice" as const, description: "Sacrifice a supply card" },
    ];
  },
  resolve(_choice, choiceIndex, state, _player, playerIndex, log) {
    const p = state.players[playerIndex];
    if (choiceIndex === 0) {
      // Sacrifice a ship
      const ships = [...p.zones.alert, ...p.zones.reserve].filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "ship";
      });
      if (ships.length > 0) {
        state.pendingChoice = {
          type: "hangar-deck-fire-ship",
          playerIndex,
          cards: ships.map((s) => s.cards[0]),
          prompt: "Hangar Deck Fire — choose a ship to sacrifice",
        };
      }
    } else {
      // Sacrifice a supply card
      for (const stack of p.zones.resourceStacks) {
        if (stack.supplyCards.length > 0) {
          const supply = stack.supplyCards.pop()!;
          p.discard.push(supply);
          log.push(`Hangar Deck Fire: ${pLabel(playerIndex, state)} sacrifices a supply card.`);
          return;
        }
      }
    }
  },
  aiDecide() {
    return 1; // AI prefers sacrificing supply over ship
  },
});

// --- Hangar Deck Fire: Pick which ship to sacrifice ---
registerPendingChoice("hangar-deck-fire-ship", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Sacrifice ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    sacrificeUnit(state.players[playerIndex], chosenCard.instanceId, log);
  },
  aiDecide(_choice, choiceActions) {
    // AI sacrifices lowest-power ship
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

// --- Network Hacking: Player chooses commit a Cylon or commit all ships ---
registerPendingChoice("network-hacking-choice", {
  getActions(choice, state) {
    const p = state.players[choice.playerIndex];
    const actions: ValidAction[] = [];
    const hasCylon = p.zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon");
    });
    const hasShip = p.zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (hasCylon) actions.push({ type: "makeChoice", description: "Commit a Cylon unit" });
    if (hasShip) actions.push({ type: "makeChoice", description: "Commit all ships" });
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const nextPlayer = (ctx.nextPlayer as number) ?? state.players.length;
    const p = state.players[playerIndex];
    // Rebuild options
    const options: string[] = [];
    const hasCylon = p.zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon");
    });
    const hasShip = p.zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (hasCylon) options.push("cylon");
    if (hasShip) options.push("ships");
    const chosen = options[choiceIndex];
    if (chosen === "cylon") {
      const cylons = p.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && hasTrait(d, "Cylon");
      });
      // Pick which Cylon
      state.pendingChoice = {
        type: "network-hacking-cylon",
        playerIndex,
        cards: cylons.map((s) => s.cards[0]),
        context: { nextPlayer },
        prompt: "Network Hacking — choose a Cylon unit to commit",
      };
    } else {
      const ships = p.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "ship";
      });
      for (const s of ships) commitUnitLocal(p, s.cards[0].instanceId, log);
      networkHackingForPlayer(state, nextPlayer, log);
    }
  },
  aiDecide(choice, choiceActions, state) {
    // AI prefers committing one Cylon over all ships
    const p = state.players[choice.playerIndex];
    const hasCylon = p.zones.alert.some((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon");
    });
    return hasCylon ? 0 : 0;
  },
});

// --- Network Hacking: Pick which Cylon to commit ---
registerPendingChoice("network-hacking-cylon", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
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
    const ctx = (choice.context ?? {}) as Record<string, unknown>;
    const nextPlayer = (ctx.nextPlayer as number) ?? state.players.length;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    commitUnitLocal(state.players[playerIndex], chosenCard.instanceId, log);
    networkHackingForPlayer(state, nextPlayer, log);
  },
  aiDecide(_choice, choiceActions) {
    // AI commits lowest-power Cylon
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

// --- Crackdown: Opponent chooses card to discard ---
registerPendingChoice("crackdown-discard", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (def) {
        actions.push({
          type: "makeChoice",
          description: `Discard ${helpers.cardName(def)}`,
          cardDefId: def.id,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const p = state.players[playerIndex];
    const idx = p.hand.findIndex((c) => c.instanceId === chosenCard.instanceId);
    if (idx >= 0) {
      const removed = p.hand.splice(idx, 1)[0];
      p.discard.push(removed);
    }
    log.push(`Crackdown: ${pLabel(playerIndex, state)} discards a card.`);
  },
  aiDecide(_choice, choiceActions) {
    // AI discards lowest mystic value
    let worstIdx = 0;
    let worstMystic = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const defId = choiceActions[i].cardDefId;
      if (defId) {
        const def = cardRegistry[defId];
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

// --- Downed Pilot: Opponent chooses — commit ship OR sacrifice personnel ---
registerPendingChoice("downed-pilot-choice", {
  getActions(choice) {
    const shipCount = ((choice.context ?? {}) as Record<string, unknown>).shipCount as number;
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (!def) continue;
      const label = i < shipCount ? "Commit" : "Sacrifice";
      actions.push({
        type: "makeChoice",
        description: `${label} ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const shipCount = ((choice.context ?? {}) as Record<string, unknown>).shipCount as number;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const p = state.players[playerIndex];
    const def = helpers.getCardDef(chosenCard.defId);
    if (choiceIndex < shipCount) {
      commitUnitLocal(p, chosenCard.instanceId, log);
      log.push(`Downed Pilot: ${pLabel(playerIndex, state)} commits ${helpers.cardName(def)}.`);
    } else {
      sacrificeUnit(p, chosenCard.instanceId, log);
      log.push(`Downed Pilot: ${pLabel(playerIndex, state)} sacrifices ${helpers.cardName(def)}.`);
    }
  },
  aiDecide(choice, choiceActions) {
    // AI prefers committing a ship (first options) over sacrificing personnel
    const shipCount = ((choice.context ?? {}) as Record<string, unknown>).shipCount as number;
    if (shipCount > 0) {
      // Commit cheapest ship
      let bestIdx = 0;
      let bestPow = Infinity;
      for (let i = 0; i < shipCount; i++) {
        const def = cardRegistry[choice.cards[i].defId];
        const pow = def?.power ?? 0;
        if (pow < bestPow) {
          bestPow = pow;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
    // No ships: sacrifice cheapest personnel
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow < bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

// --- Still No Contact: Opponent chooses — commit OR sacrifice personnel ---
registerPendingChoice("still-no-contact-choice", {
  getActions(choice) {
    const commitCount = ((choice.context ?? {}) as Record<string, unknown>).commitCount as number;
    const actions: ValidAction[] = [];
    for (let i = 0; i < choice.cards.length; i++) {
      const def = helpers.getCardDef(choice.cards[i].defId);
      if (!def) continue;
      const label = i < commitCount ? "Commit" : "Sacrifice";
      actions.push({
        type: "makeChoice",
        description: `${label} ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, playerIndex, log) {
    const commitCount = ((choice.context ?? {}) as Record<string, unknown>).commitCount as number;
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const p = state.players[playerIndex];
    const def = helpers.getCardDef(chosenCard.defId);
    if (choiceIndex < commitCount) {
      commitUnitLocal(p, chosenCard.instanceId, log);
      log.push(`Still No Contact: ${pLabel(playerIndex, state)} commits ${helpers.cardName(def)}.`);
    } else {
      sacrificeUnit(p, chosenCard.instanceId, log);
      log.push(
        `Still No Contact: ${pLabel(playerIndex, state)} sacrifices ${helpers.cardName(def)}.`,
      );
    }
  },
  aiDecide(choice, choiceActions) {
    // AI prefers committing (first options) over sacrificing
    const commitCount = ((choice.context ?? {}) as Record<string, unknown>).commitCount as number;
    if (commitCount > 0) {
      let bestIdx = 0;
      let bestPow = Infinity;
      for (let i = 0; i < commitCount; i++) {
        const def = cardRegistry[choice.cards[i].defId];
        const pow = def?.power ?? 0;
        if (pow < bestPow) {
          bestPow = pow;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choiceActions.length; i++) {
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow < bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

// --- Them or Us: Player chooses which ship to sacrifice ---
registerPendingChoice("them-or-us-ship", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (const card of choice.cards) {
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      actions.push({
        type: "makeChoice",
        description: `Sacrifice ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    sacrificeUnit(player, chosenCard.instanceId, log);
    const def = helpers.getCardDef(chosenCard.defId);
    log.push(`Them or Us: ${pLabel(playerIndex, state)} sacrifices ${helpers.cardName(def)}.`);
    // Now pick a personnel to defeat (any player)
    const allPersonnel = getAllUnits(state).filter((u) => {
      const d = getUnitDef(u.stack);
      return d && d.type === "personnel";
    });
    if (allPersonnel.length === 0) return;
    state.pendingChoice = {
      type: "them-or-us-target",
      playerIndex,
      cards: allPersonnel.map((u) => u.stack.cards[0]),
      context: { ownerIndices: allPersonnel.map((u) => u.playerIndex) },
      prompt: "Them or Us — choose a personnel to defeat",
    };
  },
  aiDecide(choice, _choiceActions, _state, _playerIndex) {
    // AI sacrifices cheapest ship
    let bestIdx = 0;
    let bestPow = Infinity;
    for (let i = 0; i < choice.cards.length; i++) {
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow < bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("them-or-us-target", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const ownerIndices = ((choice.context ?? {}) as Record<string, unknown>)
      .ownerIndices as number[];
    for (let i = 0; i < choice.cards.length; i++) {
      const card = choice.cards[i];
      const def = helpers.getCardDef(card.defId);
      if (!def) continue;
      const ownerName = pLabel(ownerIndices?.[i] ?? 0, state);
      actions.push({
        type: "makeChoice",
        description: `Defeat ${ownerName}'s ${helpers.cardName(def)}`,
        cardDefId: def.id,
      });
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, _player, _playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];
    if (!chosenCard) return;
    const owner = findUnitOwner(state, chosenCard.instanceId);
    if (owner) {
      helpers.defeatUnit(owner.player, chosenCard.instanceId, log, state, owner.playerIndex);
    }
  },
  aiDecide(choice, _choiceActions, state, playerIndex) {
    // AI defeats strongest opponent personnel
    let bestIdx = 0;
    let bestPow = -1;
    for (let i = 0; i < choice.cards.length; i++) {
      const owner = findUnitOwner(state, choice.cards[i].instanceId);
      if (!owner || owner.playerIndex === playerIndex) continue;
      const def = cardRegistry[choice.cards[i].defId];
      const pow = def?.power ?? 0;
      if (pow > bestPow) {
        bestPow = pow;
        bestIdx = i;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("reformat-count", {
  getActions(choice) {
    const maxDiscard =
      (((choice.context ?? {}) as Record<string, unknown>).maxDiscard as number) ?? 1;
    const actions: ValidAction[] = [];
    for (let i = 1; i <= maxDiscard; i++) {
      actions.push({ type: "makeChoice", description: `Discard ${i}, draw ${i}` });
    }
    return actions;
  },
  resolve(_choice, choiceIndex, state, player, playerIndex, log) {
    const discardCount = choiceIndex + 1;
    const sorted = player.hand
      .map((c, i) => ({ card: c, idx: i, mystic: cardRegistry[c.defId]?.mysticValue ?? 0 }))
      .sort((a, b) => a.mystic - b.mystic);
    const toDiscard = sorted.slice(0, discardCount);
    const indices = toDiscard.map((t) => t.idx).sort((a, b) => b - a);
    for (const idx of indices) {
      const removed = player.hand.splice(idx, 1)[0];
      player.discard.push(removed);
    }
    helpers.drawCards(player, discardCount, log, pLabel(playerIndex, state), state, playerIndex);
    log.push(`Reformat: discarded ${discardCount} cards, drew ${discardCount}.`);
  },
  aiDecide(_choice, choiceActions) {
    const mid = Math.max(0, Math.floor(choiceActions.length / 2) - 1);
    return mid;
  },
});
