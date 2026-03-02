// ============================================================
// Event Abilities Registry (Open/Closed Principle)
// ============================================================
// Each event card's effect is registered here by abilityId.
// Game engine calls dispatchers; adding new events requires
// only a new register() call — no engine changes needed.
// ============================================================

import type {
  GameState,
  PlayerState,
  CardDef,
  BaseCardDef,
  UnitStack,
  CardInstance,
} from "@bsg/shared";

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

  /** Resolve the event effect */
  resolve(state: GameState, playerIndex: number, targetId: string | undefined, log: string[]): void;
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
    log: string[],
    state: GameState,
    playerIndex: number,
  ): void;
  commitUnit(player: PlayerState, instanceId: string): void;
  drawCards(player: PlayerState, count: number, log: string[], label: string): void;
  applyPowerBuff(state: GameState, instanceId: string, amount: number, log: string[]): void;
  applyInfluenceLoss(
    state: GameState,
    playerIndex: number,
    amount: number,
    log: string[],
    bases: Record<string, BaseCardDef>,
  ): void;
  revealMysticValue(state: GameState, playerIndex: number, log: string[]): number;
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

function commitUnitLocal(player: PlayerState, instanceId: string): boolean {
  const found = findUnitInZone(player.zones.alert, instanceId);
  if (found) {
    player.zones.alert.splice(found.index, 1);
    player.zones.reserve.push(found.stack);
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

function readyUnitLocal(player: PlayerState, instanceId: string): boolean {
  const found = findUnitInZone(player.zones.reserve, instanceId);
  if (found && !found.stack.exhausted) {
    player.zones.reserve.splice(found.index, 1);
    player.zones.alert.push(found.stack);
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

function getAllUnits(
  state: GameState,
): {
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

function pLabel(playerIndex: number): string {
  return `Player ${playerIndex + 1}`;
}

function getUnitDef(stack: UnitStack): CardDef | null {
  if (!stack.cards[0]) return null;
  return cardRegistry[stack.cards[0].defId] ?? null;
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

function sacrificeUnit(player: PlayerState, instanceId: string, log: string[]): boolean {
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

function returnToHand(player: PlayerState, instanceId: string, log: string[]): boolean {
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

// BSG2-010 Covering Fire: Commit own unit → target other unit +2 power
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
    // Auto-commit cheapest alert unit (not the target)
    const alertUnits = player.zones.alert.filter(
      (s) => !s.exhausted && s.cards[0] && s.cards[0].instanceId !== targetId,
    );
    if (alertUnits.length === 0) return;
    // Pick lowest power
    let best = alertUnits[0];
    let bestPower = Infinity;
    for (const s of alertUnits) {
      const d = getUnitDef(s);
      const p = d?.power ?? 0;
      if (p < bestPower) {
        bestPower = p;
        best = s;
      }
    }
    const commitDef = getUnitDef(best);
    commitUnitLocal(player, best.cards[0].instanceId);
    log.push(`Covering Fire: ${commitDef ? helpers.cardName(commitDef) : "unit"} committed.`);
    helpers.applyPowerBuff(state, targetId, 2, log);
    log.push("Covering Fire: target unit gets +2 power.");
  },
});

// BSG2-012 Cylon Surprise: Target Cylon Machine +2 power
register("cylon-surprise", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// BSG2-031 Special Delivery: Target personnel +1 power + Scramble + draw 1
register("special-delivery", {
  playableIn: ["execution", "challenge"],
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// BSG2-033 Strafing Run: Target ship +1 power + Strafe + draw 1
register("strafing-run", {
  playableIn: ["execution", "challenge"],
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
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
      if (readyUnitLocal(p, targetId)) {
        log.push("Condition One: target unit readied.");
        return;
      }
    }
  },
});

// BSG1-016 Condition Two: Commit target unit
register("condition-two", {
  playableIn: ["execution", "challenge"],
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
      if (commitUnitLocal(p, targetId)) {
        log.push("Condition Two: target unit committed.");
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

// BSG1-023 Distraction: Commit own personnel → commit+exhaust target unit
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
    // Auto-commit cheapest alert personnel (not the target)
    const personnel = player.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted && s.cards[0]?.instanceId !== targetId;
    });
    if (personnel.length === 0) return;
    let cheapest = personnel[0];
    let cheapestPower = Infinity;
    for (const s of personnel) {
      const d = getUnitDef(s);
      if (d && (d.power ?? 0) < cheapestPower) {
        cheapestPower = d.power ?? 0;
        cheapest = s;
      }
    }
    commitUnitLocal(player, cheapest.cards[0].instanceId);
    const commitDef = getUnitDef(cheapest);
    log.push(`Distraction: ${commitDef ? helpers.cardName(commitDef) : "personnel"} committed.`);
    // Commit+exhaust the target
    for (const p of state.players) {
      const found = findUnitInZone(p.zones.alert, targetId);
      if (found) {
        p.zones.alert.splice(found.index, 1);
        found.stack.exhausted = true;
        p.zones.reserve.push(found.stack);
        log.push("Distraction: target unit committed and exhausted.");
        return;
      }
    }
  },
});

// BSG1-033 Military Coup: Exhaust own personnel → exhaust opponent's personnel
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
    // Auto-exhaust cheapest own personnel
    const ownPersonnel = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted;
    });
    if (ownPersonnel.length === 0) return;
    let cheapest = ownPersonnel[0];
    for (const s of ownPersonnel) {
      const d = getUnitDef(s);
      if (d && (d.power ?? 0) < (getUnitDef(cheapest)?.power ?? 0)) cheapest = s;
    }
    cheapest.exhausted = true;
    const ownDef = getUnitDef(cheapest);
    log.push(`Military Coup: ${ownDef ? helpers.cardName(ownDef) : "personnel"} exhausted.`);
    // Exhaust target opponent personnel
    for (const p of state.players) {
      exhaustUnitLocal(p, targetId);
    }
    log.push("Military Coup: target opponent personnel exhausted.");
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
        commitUnitLocal(p, s.cards[0].instanceId);
      }
    }
    log.push("Sneak Attack: all Fighters committed.");
  },
});

// BSG2-014 Determination: Restore target unit
register("determination", {
  playableIn: ["execution"],
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
        readyUnitLocal(p, s.cards[0].instanceId);
      }
    }
    log.push("Massive Assault: all Capital Ships and Fighters readied.");
  },
});

// BSG2-038 To the Victor: Exhaust target personnel
register("to-the-victor", {
  playableIn: ["execution", "challenge"],
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

// BSG1-021 Decoys: Commit N units → target +2N power
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
    // Commit all alert units except the target (auto-commit all for max buff)
    const toCommit = player.zones.alert.filter(
      (s) => !s.exhausted && s.cards[0] && s.cards[0].instanceId !== targetId,
    );
    let count = 0;
    for (const s of toCommit) {
      commitUnitLocal(player, s.cards[0].instanceId);
      count++;
    }
    if (count > 0) {
      helpers.applyPowerBuff(state, targetId, count * 2, log);
      log.push(`Decoys: ${count} units committed; target gets +${count * 2} power.`);
    }
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
    // AI auto-picks: commit ship if available, else sacrifice personnel
    const alertShip = oppPlayer.zones.alert.find((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (alertShip) {
      commitUnitLocal(oppPlayer, alertShip.cards[0].instanceId);
      const d = getUnitDef(alertShip);
      log.push(`Downed Pilot: ${pLabel(opp)} commits ${d ? helpers.cardName(d) : "ship"}.`);
    } else {
      // Sacrifice cheapest personnel
      const allPersonnel = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel";
      });
      if (allPersonnel.length > 0) {
        let cheapest = allPersonnel[0];
        for (const s of allPersonnel) {
          const d = getUnitDef(s);
          if (d && (d.power ?? 0) < (getUnitDef(cheapest)?.power ?? 0)) cheapest = s;
        }
        sacrificeUnit(oppPlayer, cheapest.cards[0].instanceId, log);
        log.push(`Downed Pilot: ${pLabel(opp)} sacrifices a personnel.`);
      } else {
        log.push(`Downed Pilot: ${pLabel(opp)} has no ships or personnel.`);
      }
    }
  },
});

// BSG1-025 Endless Task: Target player: commit OR exhaust a unit
register("endless-task", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    // AI picks: exhaust reserve unit if available, else commit alert
    const reserveUnit = oppPlayer.zones.reserve.find((s) => !s.exhausted && s.cards[0]);
    if (reserveUnit) {
      reserveUnit.exhausted = true;
      const d = getUnitDef(reserveUnit);
      log.push(`Endless Task: ${pLabel(opp)} exhausts ${d ? helpers.cardName(d) : "unit"}.`);
    } else {
      const alertUnit = oppPlayer.zones.alert.find((s) => s.cards[0]);
      if (alertUnit) {
        commitUnitLocal(oppPlayer, alertUnit.cards[0].instanceId);
        const d = getUnitDef(alertUnit);
        log.push(`Endless Task: ${pLabel(opp)} commits ${d ? helpers.cardName(d) : "unit"}.`);
      } else {
        log.push(`Endless Task: ${pLabel(opp)} has no units.`);
      }
    }
  },
});

// BSG1-029 Grounded: Opponent: commit ship OR commit all personnel
register("grounded", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    // AI picks: commit one ship if cheaper than committing all personnel
    const alertShip = oppPlayer.zones.alert.find((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (alertShip) {
      commitUnitLocal(oppPlayer, alertShip.cards[0].instanceId);
      const d = getUnitDef(alertShip);
      log.push(`Grounded: ${pLabel(opp)} commits ${d ? helpers.cardName(d) : "ship"}.`);
    } else {
      // Commit all personnel
      const personnel = oppPlayer.zones.alert.filter((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel";
      });
      for (const s of personnel) {
        commitUnitLocal(oppPlayer, s.cards[0].instanceId);
      }
      log.push(`Grounded: ${pLabel(opp)} commits all personnel (${personnel.length}).`);
    }
  },
});

// BSG1-030 Hangar Deck Fire: Opponent: sacrifice ship OR sacrifice supply card
register("hangar-deck-fire", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    // AI picks: sacrifice supply card if available, else sacrifice ship
    for (const stack of oppPlayer.zones.resourceStacks) {
      if (stack.supplyCards.length > 0) {
        // Remove bottom supply card
        const supply = stack.supplyCards.pop()!;
        oppPlayer.discard.push(supply);
        log.push(`Hangar Deck Fire: ${pLabel(opp)} sacrifices a supply card.`);
        return;
      }
    }
    // No supply cards, sacrifice cheapest ship
    const ships = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (ships.length > 0) {
      let cheapest = ships[0];
      for (const s of ships) {
        const d = getUnitDef(s);
        if (d && (d.power ?? 0) < (getUnitDef(cheapest)?.power ?? 0)) cheapest = s;
      }
      sacrificeUnit(oppPlayer, cheapest.cards[0].instanceId, log);
    } else {
      log.push(`Hangar Deck Fire: ${pLabel(opp)} has nothing to sacrifice.`);
    }
  },
});

// BSG1-034 Network Hacking: Each player: commit Cylon OR commit all ships
register("network-hacking", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      // AI: commit one Cylon unit if available
      const cylon = p.zones.alert.find((s) => {
        const d = getUnitDef(s);
        return d && hasTrait(d, "Cylon");
      });
      if (cylon) {
        commitUnitLocal(p, cylon.cards[0].instanceId);
        const d = getUnitDef(cylon);
        log.push(
          `Network Hacking: ${pLabel(pi)} commits ${d ? helpers.cardName(d) : "Cylon unit"}.`,
        );
      } else {
        const ships = p.zones.alert.filter((s) => {
          const d = getUnitDef(s);
          return d && d.type === "ship";
        });
        for (const s of ships) {
          commitUnitLocal(p, s.cards[0].instanceId);
        }
        log.push(`Network Hacking: ${pLabel(pi)} commits all ships (${ships.length}).`);
      }
    }
  },
});

// BSG1-041 Setback: Target player: exhaust alert OR exhaust reserve unit
register("setback", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    // AI: exhaust reserve unit if available (less impactful)
    const reserveUnit = oppPlayer.zones.reserve.find((s) => !s.exhausted && s.cards[0]);
    if (reserveUnit) {
      reserveUnit.exhausted = true;
      const d = getUnitDef(reserveUnit);
      log.push(`Setback: ${pLabel(opp)} exhausts reserve ${d ? helpers.cardName(d) : "unit"}.`);
    } else {
      const alertUnit = oppPlayer.zones.alert.find((s) => !s.exhausted && s.cards[0]);
      if (alertUnit) {
        alertUnit.exhausted = true;
        const d = getUnitDef(alertUnit);
        log.push(`Setback: ${pLabel(opp)} exhausts alert ${d ? helpers.cardName(d) : "unit"}.`);
      } else {
        log.push(`Setback: ${pLabel(opp)} has no units to exhaust.`);
      }
    }
  },
});

// BSG1-045 Still No Contact: Opponent: commit personnel OR sacrifice personnel
register("still-no-contact", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    const alertPersonnel = oppPlayer.zones.alert.find((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel";
    });
    if (alertPersonnel) {
      commitUnitLocal(oppPlayer, alertPersonnel.cards[0].instanceId);
      const d = getUnitDef(alertPersonnel);
      log.push(
        `Still No Contact: ${pLabel(opp)} commits ${d ? helpers.cardName(d) : "personnel"}.`,
      );
    } else {
      const anyPersonnel = [...oppPlayer.zones.alert, ...oppPlayer.zones.reserve].find((s) => {
        const d = getUnitDef(s);
        return d && d.type === "personnel";
      });
      if (anyPersonnel) {
        sacrificeUnit(oppPlayer, anyPersonnel.cards[0].instanceId, log);
      } else {
        log.push(`Still No Contact: ${pLabel(opp)} has no personnel.`);
      }
    }
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
  getTargets(state, playerIndex) {
    // Target any personnel (any player)
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
    // Auto-pick cheapest alert personnel to commit+exhaust (not the target if own)
    const ownPersonnel = player.zones.alert.filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && !s.exhausted && s.cards[0]?.instanceId !== targetId;
    });
    if (ownPersonnel.length === 0) return;
    let cheapest = ownPersonnel[0];
    for (const s of ownPersonnel) {
      const d = getUnitDef(s);
      if (d && (d.power ?? 0) < (getUnitDef(cheapest)?.power ?? 0)) cheapest = s;
    }
    // Commit and exhaust
    const idx = player.zones.alert.indexOf(cheapest);
    if (idx >= 0) {
      player.zones.alert.splice(idx, 1);
      cheapest.exhausted = true;
      player.zones.reserve.push(cheapest);
    }
    const ownDef = getUnitDef(cheapest);
    log.push(`Angry: ${ownDef ? helpers.cardName(ownDef) : "personnel"} committed and exhausted.`);
    // Defeat target
    const targetOwner = findUnitOwner(state, targetId);
    if (targetOwner) {
      helpers.defeatUnit(targetOwner.player, targetId, log, state, targetOwner.playerIndex);
    }
  },
});

// BSG1-048 Suicide Bomber: Sacrifice Cylon personnel → defeat 2 target personnel
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
    // Sacrifice cheapest Cylon personnel
    const cylonPersonnel = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && hasTrait(d, "Cylon");
    });
    if (cylonPersonnel.length === 0) return;
    sacrificeUnit(player, cylonPersonnel[0].cards[0].instanceId, log);
    log.push("Suicide Bomber: Cylon personnel sacrificed.");
    // Defeat target personnel
    const targetOwner = findUnitOwner(state, targetId);
    if (targetOwner) {
      helpers.defeatUnit(targetOwner.player, targetId, log, state, targetOwner.playerIndex);
    }
    // Defeat second target (auto-pick another opponent personnel)
    const opp = 1 - playerIndex;
    const oppPersonnel = [
      ...state.players[opp].zones.alert,
      ...state.players[opp].zones.reserve,
    ].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "personnel" && s.cards[0]?.instanceId !== targetId;
    });
    if (oppPersonnel.length > 0) {
      helpers.defeatUnit(state.players[opp], oppPersonnel[0].cards[0].instanceId, log, state, opp);
    }
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
    // Sacrifice cheapest ship
    const ships = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && d.type === "ship";
    });
    if (ships.length === 0) return;
    let cheapest = ships[0];
    for (const s of ships) {
      const d = getUnitDef(s);
      if (d && (d.power ?? 0) < (getUnitDef(cheapest)?.power ?? 0)) cheapest = s;
    }
    sacrificeUnit(player, cheapest.cards[0].instanceId, log);
    // Defeat target
    const owner = findUnitOwner(state, targetId);
    if (owner) {
      helpers.defeatUnit(owner.player, targetId, log, state, owner.playerIndex);
    }
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
  canPlay(state, playerIndex) {
    return [
      ...state.players[playerIndex].zones.alert,
      ...state.players[playerIndex].zones.reserve,
    ].some((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon") && (d.type === "personnel" || d.type === "ship");
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
    // Auto-pick cheapest Cylon unit to put on deck
    const cylons = [...player.zones.alert, ...player.zones.reserve].filter((s) => {
      const d = getUnitDef(s);
      return d && hasTrait(d, "Cylon") && (d.type === "personnel" || d.type === "ship");
    });
    if (cylons.length === 0) return;
    const cylon = cylons[0];
    const found = findUnitInAnyZone(player, cylon.cards[0].instanceId);
    if (found) {
      const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
      zone.splice(found.index, 1);
      for (const card of found.stack.cards.reverse()) {
        player.deck.unshift(card);
      }
      const d = getUnitDef(cylon);
      log.push(`Painful Recovery: ${d ? helpers.cardName(d) : "Cylon unit"} put on top of deck.`);
    }
    // Commit+exhaust target personnel
    for (const p of state.players) {
      const tgt = findUnitInZone(p.zones.alert, targetId);
      if (tgt) {
        p.zones.alert.splice(tgt.index, 1);
        tgt.stack.exhausted = true;
        p.zones.reserve.push(tgt.stack);
        log.push("Painful Recovery: target personnel committed and exhausted.");
        return;
      }
      // If already in reserve, just exhaust
      const tgt2 = findUnitInZone(p.zones.reserve, targetId);
      if (tgt2) {
        tgt2.stack.exhausted = true;
        log.push("Painful Recovery: target personnel exhausted.");
        return;
      }
    }
  },
});

// ============================================================
// 7. MISSION MANIPULATION (4 events)
// ============================================================

// BSG1-013 Catastrophe: Defeat target persistent mission
register("catastrophe", {
  playableIn: ["execution"],
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

// BSG1-009 Act of Contrition: Target reveals hand, discard a card (simplified)
register("act-of-contrition", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    if (oppPlayer.hand.length === 0) {
      log.push(`Act of Contrition: ${pLabel(opp)} has no cards in hand.`);
      return;
    }
    log.push(`Act of Contrition: ${pLabel(opp)} reveals hand (${oppPlayer.hand.length} cards).`);
    // Auto-pick: discard card with highest cost (simplified)
    let bestIdx = 0;
    let bestCost = 0;
    for (let i = 0; i < oppPlayer.hand.length; i++) {
      const def = cardRegistry[oppPlayer.hand[i].defId];
      if (def?.cost) {
        const total = Object.values(def.cost).reduce((a: number, b: number) => a + b, 0);
        if (total > bestCost) {
          bestCost = total;
          bestIdx = i;
        }
      }
    }
    const discarded = oppPlayer.hand.splice(bestIdx, 1)[0];
    oppPlayer.discard.push(discarded);
    const discDef = cardRegistry[discarded.defId];
    log.push(`Act of Contrition: ${discDef ? helpers.cardName(discDef) : "card"} discarded.`);
  },
});

// BSG1-010 Advanced Planning: Look at top 5, keep best on top, rest on bottom
register("advanced-planning", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    const top5: CardInstance[] = [];
    for (let i = 0; i < 5 && player.deck.length > 0; i++) {
      top5.push(player.deck.shift()!);
    }
    if (top5.length === 0) return;
    // Auto-pick: keep highest mystic value on top
    let bestIdx = 0;
    let bestMystic = 0;
    for (let i = 0; i < top5.length; i++) {
      const def = cardRegistry[top5[i].defId];
      if (def && (def.mysticValue ?? 0) > bestMystic) {
        bestMystic = def.mysticValue ?? 0;
        bestIdx = i;
      }
    }
    const kept = top5.splice(bestIdx, 1)[0];
    player.deck.unshift(kept); // put on top
    // Rest on bottom
    for (const card of top5) {
      player.deck.push(card);
    }
    const keptDef = cardRegistry[kept.defId];
    log.push(
      `Advanced Planning: looked at top 5 cards; kept ${keptDef ? helpers.cardName(keptDef) : "a card"} on top.`,
    );
  },
});

// BSG1-017 Crackdown: Target opponent discards a card
register("crackdown", {
  playableIn: ["execution", "challenge"],
  resolve(state, playerIndex, _targetId, log) {
    const opp = 1 - playerIndex;
    const oppPlayer = state.players[opp];
    if (oppPlayer.hand.length === 0) {
      log.push(`Crackdown: ${pLabel(opp)} has no cards.`);
      return;
    }
    // AI: discard lowest mystic value
    let worstIdx = 0;
    let worstMystic = Infinity;
    for (let i = 0; i < oppPlayer.hand.length; i++) {
      const def = cardRegistry[oppPlayer.hand[i].defId];
      if (def && (def.mysticValue ?? 0) < worstMystic) {
        worstMystic = def.mysticValue ?? 0;
        worstIdx = i;
      }
    }
    const discarded = oppPlayer.hand.splice(worstIdx, 1)[0];
    oppPlayer.discard.push(discarded);
    log.push(`Crackdown: ${pLabel(opp)} discards a card.`);
  },
});

// BSG1-018 Cylon Computer Virus: All discard hands, redraw starting hand size
register("cylon-computer-virus", {
  playableIn: ["execution"],
  resolve(state, _playerIndex, _targetId, log) {
    for (let pi = 0; pi < state.players.length; pi++) {
      const p = state.players[pi];
      const handSize = p.hand.length; // Use current hand size as proxy for starting
      for (const card of p.hand) {
        p.discard.push(card);
      }
      p.hand = [];
      helpers.drawCards(p, handSize, log, pLabel(pi));
    }
    log.push("Cylon Computer Virus: all players discarded and redrew.");
  },
});

// BSG1-040 Reformat: Discard X, draw X (simplified: discard weakest)
register("reformat", {
  playableIn: ["execution"],
  resolve(state, playerIndex, _targetId, log) {
    const player = state.players[playerIndex];
    if (player.hand.length === 0) return;
    // Discard half (rounded down), minimum 1
    const discardCount = Math.max(1, Math.floor(player.hand.length / 2));
    // Sort by mystic value ascending, discard weakest
    const sorted = player.hand
      .map((c, i) => ({ card: c, idx: i, mystic: cardRegistry[c.defId]?.mysticValue ?? 0 }))
      .sort((a, b) => a.mystic - b.mystic);
    const toDiscard = sorted.slice(0, discardCount);
    // Remove from end to avoid index shifting
    const indices = toDiscard.map((t) => t.idx).sort((a, b) => b - a);
    for (const idx of indices) {
      const removed = player.hand.splice(idx, 1)[0];
      player.discard.push(removed);
    }
    helpers.drawCards(player, discardCount, log, pLabel(playerIndex));
    log.push(`Reformat: discarded ${discardCount} cards, drew ${discardCount}.`);
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
      log.push(`Full Disclosure: ${pLabel(pi)} reveals: ${names || "(empty hand)"}`);
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
      helpers.drawCards(player, maxSupply, log, pLabel(playerIndex));
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
      log.push(`Networked Computers: ${pLabel(pi)} reveals mystic value ${mystic}.`);
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
        `Networked Computers: ${pLabel(bestPlayer)} recovers ${rDef ? helpers.cardName(rDef) : "card"} from discard.`,
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
      `Test of Faith: ${pLabel(playerIndex)} gains 1 influence. (Now ${state.players[playerIndex].influence})`,
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
        `High Stakes Game: ${pLabel(pi)} reveals hand. ${count} cards with highest mystic value.`,
      );
    }
    for (let pi = 0; pi < state.players.length; pi++) {
      if (totals[pi] === bestTotal && !state.preventInfluenceGain) {
        state.players[pi].influence += 2;
        log.push(
          `High Stakes Game: ${pLabel(pi)} gains 2 influence. (Now ${state.players[pi].influence})`,
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
    if (challenger) commitUnitLocal(challenger.player, state.challenge.challengerInstanceId);
    if (defender) commitUnitLocal(defender.player, state.challenge.defenderInstanceId!);
    state.challenge.forceEnd = true;
    log.push("...Sign: challenge ends; both ships committed.");
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// BSG2-013 Cylons on the Brain: Target personnel gains Cylon trait
register("cylons-on-brain", {
  playableIn: ["execution"],
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// BSG2-026 Out of Sight: Target personnel gains Scramble + draw 1
register("out-of-sight", {
  playableIn: ["execution", "challenge"],
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// BSG2-041 Unexpected...: Target Cylon ship loses Cylon trait
register("unexpected", {
  playableIn: ["execution"],
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
        log.push(`Cylons Look Like Humans: ${pLabel(pi)} mills ${cylonCount} cards.`);
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
    helpers.drawCards(state.players[playerIndex], 1, log, pLabel(playerIndex));
  },
});

// ============================================================
// 13. DEFERRED (2 events — need effect-immunity system)
// ============================================================

// BSG2-007 Anti-Radiation Dosage
register("anti-radiation", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(_state, _playerIndex, _targetId, log) {
    log.push("Anti-Radiation Dosage: effect immunity (deferred — not yet implemented).");
  },
});

// BSG2-018 Fallout Shelter
register("fallout-shelter", {
  playableIn: ["execution", "challenge", "cylon-challenge"],
  getTargets(state) {
    return getAllUnits(state).map((u) => u.instanceId);
  },
  resolve(_state, _playerIndex, _targetId, log) {
    log.push("Fallout Shelter: full effect immunity (deferred — not yet implemented).");
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
  log: string[],
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
  return handler.getTargets(state, playerIndex, context);
}

export function canPlayEvent(abilityId: string, state: GameState, playerIndex: number): boolean {
  const handler = registry.get(abilityId);
  if (!handler) return true; // unknown events are always playable
  if (handler.canPlay) return handler.canPlay(state, playerIndex);
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
