/**
 * Cylon Threat Red-Text Registry — OCP pattern for cylon threat text effects.
 *
 * Replaces the if-else chain in fireCylonThreatRedText() in game-engine.ts.
 * Each handler matches a text pattern and applies its effect.
 * Handlers are checked in registration order (first match wins).
 */
import type { GameState, CardDef, BaseCardDef, LogItem } from "@bsg/shared";

// ============================================================
// Helpers interface — injected by game-engine.ts via DI
// ============================================================

export interface CylonThreatHelpers {
  getCardDef(defId: string): CardDef;
  commitUnit(player: GameState["players"][0], instanceId: string, log?: LogItem[]): void;
  findUnitInAnyZone(
    player: GameState["players"][0],
    instanceId: string,
  ): { stack: { exhausted?: boolean }; zone: "alert" | "reserve"; index: number } | null;
  applyInfluenceLoss(
    state: GameState,
    playerIndex: number,
    amount: number,
    log: LogItem[],
    bases: Record<string, BaseCardDef>,
  ): void;
  bases: Record<string, BaseCardDef>;
}

// ============================================================
// Handler interface
// ============================================================

export interface CylonThreatHandler {
  /** Return true if this handler matches the given lowercase text. */
  matches(text: string): boolean;
  /** Apply the effect to the game state. */
  apply(state: GameState, def: CardDef, log: LogItem[]): void;
}

// ============================================================
// Registry + DI
// ============================================================

const handlers: CylonThreatHandler[] = [];
let h: CylonThreatHelpers;

export function setCylonThreatHelpers(helpers: CylonThreatHelpers): void {
  h = helpers;
}

export function registerCylonThreat(handler: CylonThreatHandler): void {
  handlers.push(handler);
}

/**
 * Try to apply a registered handler for the given cylon threat text.
 * Returns true if a handler matched, false otherwise (signals fallback).
 */
export function applyRegisteredCylonThreat(
  state: GameState,
  def: CardDef,
  text: string,
  log: LogItem[],
): boolean {
  for (const handler of handlers) {
    if (handler.matches(text)) {
      handler.apply(state, def, log);
      return true;
    }
  }
  return false;
}

// ============================================================
// Handler registrations — order matters (more specific first)
// ============================================================

// --- Discard ---
registerCylonThreat({
  matches: (text) => text.includes("each player discards a card"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      if (p.hand.length > 0) {
        let worstIdx = 0;
        let worstVal = Infinity;
        for (let i = 0; i < p.hand.length; i++) {
          const d = h.getCardDef(p.hand[i].defId);
          if ((d.mysticValue ?? 0) < worstVal) {
            worstVal = d.mysticValue ?? 0;
            worstIdx = i;
          }
        }
        const removed = p.hand.splice(worstIdx, 1)[0];
        p.discard.push(removed);
      }
    }
    log.push("  → Each player discards a card.");
  },
});

// --- Influence loss ---
registerCylonThreat({
  matches: (text) => text.includes("each player loses 1 influence"),
  apply: (state, _def, log) => {
    for (let pi = 0; pi < state.players.length; pi++) {
      h.applyInfluenceLoss(state, pi, 1, log, h.bases);
    }
    log.push("  → Each player loses 1 influence.");
  },
});

// --- Mill top card ---
registerCylonThreat({
  matches: (text) =>
    text.includes("each player puts the top card of his or her deck into his or her discard pile"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      if (p.deck.length > 0) {
        const card = p.deck.shift()!;
        p.discard.push(card);
      }
    }
    log.push("  → Each player mills top card.");
  },
});

// --- Exhaust base ---
registerCylonThreat({
  matches: (text) => text.includes("each player exhausts") && text.includes("base"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      const baseStack = p.zones.resourceStacks[0];
      if (baseStack && !baseStack.exhausted) baseStack.exhausted = true;
    }
    log.push("  → Each player exhausts their base.");
  },
});

// --- Exhaust bare asset (no supply) — must come before generic "asset" ---
registerCylonThreat({
  matches: (text) =>
    text.includes("each player exhausts") && text.includes("asset") && text.includes("no supply"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (let si = 1; si < p.zones.resourceStacks.length; si++) {
        if (
          !p.zones.resourceStacks[si].exhausted &&
          p.zones.resourceStacks[si].supplyCards.length === 0
        ) {
          p.zones.resourceStacks[si].exhausted = true;
          break;
        }
      }
    }
    log.push("  → Each player exhausts a bare asset.");
  },
});

// --- Exhaust asset ---
registerCylonThreat({
  matches: (text) => text.includes("each player exhausts") && text.includes("asset"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (let si = 1; si < p.zones.resourceStacks.length; si++) {
        if (!p.zones.resourceStacks[si].exhausted) {
          p.zones.resourceStacks[si].exhausted = true;
          break;
        }
      }
    }
    log.push("  → Each player exhausts an asset.");
  },
});

// --- Exhaust resource stack ---
registerCylonThreat({
  matches: (text) => text.includes("each player exhausts") && text.includes("resource stack"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of p.zones.resourceStacks) {
        if (!stack.exhausted) {
          stack.exhausted = true;
          break;
        }
      }
    }
    log.push("  → Each player exhausts a resource stack.");
  },
});

// --- Exhaust reserve unit ---
registerCylonThreat({
  matches: (text) => text.includes("each player exhausts") && text.includes("reserve unit"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of p.zones.reserve) {
        if (!stack.exhausted && stack.cards[0]?.faceUp) {
          stack.exhausted = true;
          break;
        }
      }
    }
    log.push("  → Each player exhausts a reserve unit.");
  },
});

// --- Exhaust personnel ---
registerCylonThreat({
  matches: (text) => text.includes("each player exhausts") && text.includes("personnel"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        let found = false;
        for (const stack of zone) {
          if (!stack.exhausted && stack.cards[0]?.faceUp) {
            const d = h.getCardDef(stack.cards[0].defId);
            if (d.type === "personnel") {
              stack.exhausted = true;
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
    }
    log.push("  → Each player exhausts a personnel.");
  },
});

// --- Commit + exhaust personnel (must come before "commits" + "personnel") ---
registerCylonThreat({
  matches: (text) =>
    text.includes("each player commits") && text.includes("exhausts") && text.includes("personnel"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of p.zones.alert) {
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "personnel") {
            h.commitUnit(p, stack.cards[0].instanceId, log);
            const found = h.findUnitInAnyZone(p, stack.cards[0].instanceId);
            if (found) found.stack.exhausted = true;
            break;
          }
        }
      }
    }
    log.push("  → Each player commits and exhausts a personnel.");
  },
});

// --- Commit personnel ---
registerCylonThreat({
  matches: (text) => text.includes("each player commits") && text.includes("personnel"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of [...p.zones.alert]) {
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "personnel") {
            h.commitUnit(p, stack.cards[0].instanceId, log);
            break;
          }
        }
      }
    }
    log.push("  → Each player commits a personnel.");
  },
});

// --- Commit cylon unit ---
registerCylonThreat({
  matches: (text) => text.includes("each player commits") && text.includes("cylon unit"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of [...p.zones.alert]) {
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.traits?.includes("Cylon")) {
            h.commitUnit(p, stack.cards[0].instanceId, log);
            break;
          }
        }
      }
    }
    log.push("  → Each player commits a Cylon unit.");
  },
});

// --- Commit ship ---
registerCylonThreat({
  matches: (text) => text.includes("each player commits") && text.includes("ship"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of [...p.zones.alert]) {
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "ship") {
            h.commitUnit(p, stack.cards[0].instanceId, log);
            break;
          }
        }
      }
    }
    log.push("  → Each player commits a ship.");
  },
});

// --- Commit unit (generic) ---
registerCylonThreat({
  matches: (text) => text.includes("each player commits") && text.includes("unit"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of [...p.zones.alert]) {
        if (stack.cards[0]?.faceUp) {
          h.commitUnit(p, stack.cards[0].instanceId, log);
          break;
        }
      }
    }
    log.push("  → Each player commits a unit.");
  },
});

// --- Sacrifice reserve ship ---
registerCylonThreat({
  matches: (text) => text.includes("each player sacrifices") && text.includes("reserve ship"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (let i = 0; i < p.zones.reserve.length; i++) {
        const stack = p.zones.reserve[i];
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "ship") {
            p.zones.reserve.splice(i, 1);
            for (const c of stack.cards) p.discard.push(c);
            break;
          }
        }
      }
    }
    log.push("  → Each player sacrifices a reserve ship.");
  },
});

// --- Sacrifice reserve personnel ---
registerCylonThreat({
  matches: (text) => text.includes("each player sacrifices") && text.includes("reserve personnel"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (let i = 0; i < p.zones.reserve.length; i++) {
        const stack = p.zones.reserve[i];
        if (stack.cards[0]?.faceUp) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "personnel") {
            p.zones.reserve.splice(i, 1);
            for (const c of stack.cards) p.discard.push(c);
            break;
          }
        }
      }
    }
    log.push("  → Each player sacrifices a reserve personnel.");
  },
});

// --- Sacrifice personnel (any zone) ---
registerCylonThreat({
  matches: (text) => text.includes("each player sacrifices") && text.includes("personnel"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        let found = false;
        for (let i = 0; i < zone.length; i++) {
          const stack = zone[i];
          if (stack.cards[0]?.faceUp) {
            const d = h.getCardDef(stack.cards[0].defId);
            if (d.type === "personnel") {
              zone.splice(i, 1);
              for (const c of stack.cards) p.discard.push(c);
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
    }
    log.push("  → Each player sacrifices a personnel.");
  },
});

// --- Sacrifice unit (generic) ---
registerCylonThreat({
  matches: (text) => text.includes("each player sacrifices") && text.includes("unit"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const zone of [p.zones.alert, p.zones.reserve]) {
        let found = false;
        for (let i = 0; i < zone.length; i++) {
          const stack = zone[i];
          if (stack.cards[0]?.faceUp) {
            zone.splice(i, 1);
            for (const c of stack.cards) p.discard.push(c);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    log.push("  → Each player sacrifices a unit.");
  },
});

// --- Power debuffs (politicians/officers/ships -1 power) ---
registerCylonThreat({
  matches: (text) =>
    text.includes("all politicians get -1 power") ||
    text.includes("all officers get -1 power") ||
    text.includes("all ships get -1 power"),
  apply: (_state, _def, log) => {
    log.push("  → Power debuff applied (lasts until end of phase).");
  },
});

// --- Put card from hand on top of deck ---
registerCylonThreat({
  matches: (text) =>
    text.includes("puts a card from") && text.includes("hand on top of") && text.includes("deck"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      if (p.hand.length > 0) {
        let worstIdx = 0;
        let worstVal = Infinity;
        for (let i = 0; i < p.hand.length; i++) {
          const d = h.getCardDef(p.hand[i].defId);
          if ((d.mysticValue ?? 0) < worstVal) {
            worstVal = d.mysticValue ?? 0;
            worstIdx = i;
          }
        }
        const card = p.hand.splice(worstIdx, 1)[0];
        p.deck.unshift(card);
      }
    }
    log.push("  → Each player puts a card from hand on top of deck.");
  },
});

// --- Recover personnel from discard to hand ---
registerCylonThreat({
  matches: (text) =>
    text.includes("chooses a personnel card from") &&
    text.includes("discard") &&
    text.includes("hand"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (let i = 0; i < p.discard.length; i++) {
        const d = h.getCardDef(p.discard[i].defId);
        if (d.type === "personnel") {
          const card = p.discard.splice(i, 1)[0];
          p.hand.push(card);
          break;
        }
      }
    }
    log.push("  → Each player recovers a personnel from discard.");
  },
});

// --- Readies a ship ---
registerCylonThreat({
  matches: (text) => text.includes("readies a ship"),
  apply: (state, _def, log) => {
    for (const p of state.players) {
      for (const stack of p.zones.reserve) {
        if (stack.cards[0]?.faceUp && !stack.exhausted) {
          const d = h.getCardDef(stack.cards[0].defId);
          if (d.type === "ship") {
            const idx = p.zones.reserve.indexOf(stack);
            if (idx >= 0) {
              p.zones.reserve.splice(idx, 1);
              p.zones.alert.push(stack);
            }
            break;
          }
        }
      }
    }
    log.push("  → Each player readies a ship.");
  },
});
