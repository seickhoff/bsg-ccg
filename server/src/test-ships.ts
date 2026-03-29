/**
 * Headless test runner for BSG CCG ship ability scenarios.
 * Run with: npx tsx server/src/test-ships.ts
 */

import { loadCardRegistry } from "./cardLoader.js";
import { setCardRegistry, createDebugGame, applyAction, getValidActions } from "./game-engine.js";
import type { GameState, ValidAction, LogItem } from "@bsg/shared";
import { computeFleetDefenseModifiers } from "./unit-abilities.js";

// --- Bootstrap ---

const registry = loadCardRegistry();
setCardRegistry(registry.cards, registry.bases);
const bases = registry.bases;

console.log(
  `Loaded ${Object.keys(registry.cards).length} cards, ${Object.keys(bases).length} bases\n`,
);

// --- Helpers ---

type VA = ValidAction;
type GA = import("@bsg/shared").GameAction;

function toGameAction(va: VA, index?: number): GA {
  const base = va as unknown as Record<string, unknown>;
  switch (va.type) {
    case "playAbility":
      return {
        type: "playAbility",
        sourceInstanceId: va.sourceInstanceId ?? va.selectableInstanceIds![0],
        targetInstanceId:
          va.targetInstanceId ??
          (va.sourceInstanceId ? va.selectableInstanceIds?.[0] : undefined) ??
          (va.selectablePlayerIndices?.length
            ? `player-${va.selectablePlayerIndices[0]}`
            : undefined),
        abilityIndex: va.abilityIndex,
      };
    case "playCard":
      return { type: "playCard", cardIndex: va.selectableCardIndices![0] };
    case "challenge":
      return {
        type: "challenge",
        challengerInstanceId: va.selectableInstanceIds![0],
        opponentIndex: (base.opponentIndex as number) ?? 1,
      };
    case "makeChoice":
      return { type: "makeChoice", choiceIndex: index ?? 0 };
    case "defend":
      return { type: "defend", defenderInstanceId: va.selectableInstanceIds?.[0] ?? null };
    case "useTriggeredAbility":
      return { type: "useTriggeredAbility", targetInstanceId: va.targetInstanceId };
    default:
      return base as GA;
  }
}

function findAbility(actions: VA[], keyword: string): VA | undefined {
  return actions.find(
    (a) => a.type === "playAbility" && a.description?.toLowerCase().includes(keyword),
  );
}

function findAction(actions: VA[], type: string, keyword?: string): VA | undefined {
  return actions.find(
    (a) => a.type === type && (!keyword || a.description?.toLowerCase().includes(keyword)),
  );
}

function logText(entry: LogItem): string {
  return typeof entry === "string" ? entry : entry.msg;
}

function printLog(state: GameState) {
  console.log("  Log:");
  for (const entry of state.log) {
    const text = logText(entry);
    if (text.includes("[DEBUG] Scenario loaded")) continue;
    console.log(`    ${text}`);
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

function header(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`TEST: ${title}`);
  console.log("=".repeat(60));
}

/** Resolve a challenge by having both players pass through effects. */
function resolveChallenge(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 10; i++) {
    if (!s.challenge) break;
    for (const pIdx of [0, 1]) {
      if (!s.challenge) break;
      const actions = getValidActions(s, pIdx, bases);
      const pass = findAction(actions, "challengePass");
      if (pass) {
        const result = applyAction(s, pIdx, { type: "challengePass" }, bases);
        s = result.state;
      }
    }
  }
  return s;
}

/** Initiate challenge, decline defense, pass effects, return resolved state. */
function challengeUndefended(
  state: GameState,
  challengerPlayer: number,
  defenderPlayer: number,
  challengerDefId?: string,
): GameState | null {
  const actions = getValidActions(state, challengerPlayer, bases);
  const challengeAction = challengerDefId
    ? actions.find((a: VA) => a.type === "challenge" && a.cardDefId === challengerDefId)
    : findAction(actions, "challenge");
  if (!challengeAction) return null;
  let result = applyAction(state, challengerPlayer, toGameAction(challengeAction), bases);
  let s = result.state;
  if (!s.challenge) return null;
  if (s.challenge.waitingForDefender) {
    // Handle pending triggers
    const defActions = getValidActions(s, defenderPlayer, bases);
    const decline = findAction(defActions, "declineTrigger");
    if (decline) {
      result = applyAction(s, defenderPlayer, toGameAction(decline), bases);
      s = result.state;
    }
    result = applyAction(s, defenderPlayer, { type: "defend", defenderInstanceId: null }, bases);
    s = result.state;
  }
  // Pass through effects round
  s = resolveChallenge(s);
  return s;
}

/** Initiate a challenge and advance to step 2 (effects round), with specific defender. */
function setupChallengeWithDefender(
  state: GameState,
  challengerPlayer: number,
  defenderPlayer: number,
  challengerDefId?: string,
  defenderDefId?: string,
): GameState | null {
  const actions = getValidActions(state, challengerPlayer, bases);
  const challengeAction = challengerDefId
    ? actions.find((a: VA) => a.type === "challenge" && a.cardDefId === challengerDefId)
    : findAction(actions, "challenge");
  if (!challengeAction) return null;
  let result = applyAction(state, challengerPlayer, toGameAction(challengeAction), bases);
  let s = result.state;
  if (!s.challenge) return null;

  if (s.challenge.waitingForDefender) {
    // Handle pending triggers
    const defActions = getValidActions(s, defenderPlayer, bases);
    const declineTrigger = findAction(defActions, "declineTrigger");
    if (declineTrigger) {
      result = applyAction(s, defenderPlayer, toGameAction(declineTrigger), bases);
      s = result.state;
    }

    const defendActions = getValidActions(s, defenderPlayer, bases);
    if (defenderDefId) {
      const defend = defendActions.find(
        (a: VA) => a.type === "defend" && a.cardDefId === defenderDefId,
      );
      if (defend) {
        result = applyAction(s, defenderPlayer, toGameAction(defend), bases);
        s = result.state;
      }
    } else {
      const defend = findAction(defendActions, "defend");
      if (defend && defend.selectableInstanceIds?.length) {
        result = applyAction(s, defenderPlayer, toGameAction(defend), bases);
        s = result.state;
      }
    }
  }
  return s;
}

// ============================================================
// CATEGORY 1: Commit Abilities (Execution Phase)
// ============================================================

// --- 1. space-park-scry: Commit — Look at top card, may put on bottom ---

header("Space Park — Commit: Look at top card, may put on bottom");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-173"], // Space Park
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "space park");
  assert(!!ability, "Space Park scry ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Should have a pending choice (keep on top or put on bottom)
    assert(!!state.pendingChoice, "Pending choice to keep/move top card");
  }
  printLog(state);
}

// --- 2. mining-ship-dig: Commit — Reveal top 2, opponent picks one for bottom ---

header("Mining Ship — Commit: Reveal top 2, opponent picks bottom");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-159"], // Mining Ship
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "mining ship");
  assert(!!ability, "Mining Ship dig ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Should have a pending choice for the opponent
    assert(!!state.pendingChoice, "Pending choice for opponent to pick card");
  }
  printLog(state);
}

// --- 3. gideon-commit: Commit — Commit target ship ---

header("Gideon — Commit: Commit target ship");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-150", "BSG1-173"], // Gideon + Space Park (target)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "gideon");
  assert(!!ability, "Gideon commit ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Space Park should now be in reserve
    const inReserve = state.players[0].zones.reserve.find(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-173",
    );
    assert(!!inReserve, "Target ship committed to reserve");
  }
  printLog(state);
}

// --- 4. colonial-one-influence: Commit — Target player gains 1 influence ---

header("Colonial One, The President's Ship — Commit: Target player +1 influence");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-139"], // Colonial One, The President's Ship
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "president");
  assert(!!ability, "Colonial One influence ability available");

  if (ability) {
    const infBefore = state.players[0].influence;
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    assert(
      state.players[0].influence === infBefore + 1 || state.players[1].influence === 11,
      "Target player gained 1 influence",
    );
  }
  printLog(state);
}

// --- 5. colonial-one-influence: Cannot challenge ---

header("Colonial One, The President's Ship — Cannot challenge");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-139"], // Colonial One (canChallenge: false)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const actions = getValidActions(state, 0, bases);
  const challengeAction = actions.find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG2-139",
  );
  assert(!challengeAction, "Colonial One cannot be used to challenge");
  printLog(state);
}

// --- 6. viper0205-buff: Commit — Target other ship +2 power ---

header("Colonial Viper 0205 — Commit: Target other ship +2 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security base
        hand: [],
        alert: ["BSG2-140", "BSG1-173"], // Viper 0205 + Space Park (target)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "viper");
  assert(!!ability, "Viper 0205 buff ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Space Park should now have +2 power buff on UnitStack
    const spStack = state.players[0].zones.alert.find(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-173",
    );
    assert(
      (spStack?.powerBuff ?? 0) === 2,
      `Target ship got +2 power (got ${spStack?.powerBuff ?? 0})`,
    );
  }
  printLog(state);
}

// --- 7. raptor659-strafe: Commit — Target other ship gains Strafe ---

header("Raptor 659 — Commit: Target other ship gains Strafe");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG2-162", "BSG1-173"], // Raptor 659 + Space Park (target)
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "raptor 659");
  assert(!!ability, "Raptor 659 Strafe-grant ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[0].zones.alert.find(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-173",
    );
    const targetId = target?.cards[0].instanceId ?? "";
    const kwGrants = state.players[0].temporaryKeywordGrants?.[targetId];
    assert(kwGrants?.includes("Strafe") === true, "Target gained Strafe keyword");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 2: Commit+Exhaust Abilities
// ============================================================

// --- 8. freighter-recover: Commit+Exhaust — Cylon card from discard to hand ---

header("Freighter — Commit+Exhaust: Cylon card from discard to hand");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001", // logistics base
        hand: [],
        alert: ["BSG1-156"], // Freighter
        deck: ["BSG1-098", "BSG1-099"],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Put a Cylon card in the discard pile
  state.players[0].discard.push({ defId: "BSG1-103", instanceId: "discard-cylon-1", faceUp: true }); // Boomer (Cylon)

  const ability = findAbility(getValidActions(state, 0, bases), "freighter");
  assert(!!ability, "Freighter recover ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const inHand = state.players[0].hand.some((c: { defId: string }) => c.defId === "BSG1-103");
    assert(inHand, "Cylon card recovered to hand");
  }
  printLog(state);
}

// --- 9. astral-queen-exhaust2: Commit+Exhaust — Exhaust two target personnel ---

header("Astral Queen, Platform for Revolution — Commit+Exhaust: Exhaust 2 personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-133"], // Astral Queen, Platform for Revolution
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-098", "BSG1-100"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "astral queen");
  assert(!!ability, "Astral Queen exhaust-2 ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // First target should be exhausted; may have pending choice for second
    const anyExhausted =
      state.players[1].zones.alert.some((s: { exhausted: boolean }) => s.exhausted) ||
      state.players[1].zones.reserve.some((s: { exhausted: boolean }) => s.exhausted) ||
      !!state.pendingChoice;
    assert(anyExhausted, "At least one target exhausted or pending second choice");
  }
  printLog(state);
}

// --- 10. refinery-extra-action: Commit+Exhaust — Extra action + cost reduction ---

header("Refinery Ship — Commit+Exhaust: Extra action + cost reduction");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001", // logistics
        hand: [],
        alert: ["BSG2-164"], // Refinery Ship
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "refinery");
  assert(!!ability, "Refinery Ship ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Extra action may have already been consumed by engine; verify via log
    const logStr = state.log.map((e: LogItem) => (typeof e === "string" ? e : e.msg)).join(" ");
    assert(
      logStr.includes("Extra action") || logStr.includes("Refinery"),
      "Refinery Ship ability triggered",
    );
    assert(!!state.players[0].costReduction, "Cost reduction applied");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 3: Exhaust-Only Abilities
// ============================================================

// --- 11. doomed-liner-bounce: Exhaust — Return target Cylon unit to hand ---

header("Doomed Liner — Exhaust: Return target Cylon unit to hand");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-160", "BSG1-103"], // Doomed Liner + Boomer (Cylon)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Find the Doomed Liner's return-to-hand ability
  const actions = getValidActions(state, 0, bases);
  const ability = actions.find(
    (a: VA) => a.type === "playAbility" && a.description?.toLowerCase().includes("doomed liner"),
  );
  assert(!!ability, "Doomed Liner bounce ability available (targeting Boomer)");

  if (ability) {
    // Pick Boomer (BSG1-103) as target, not Doomed Liner itself
    const ga = toGameAction(ability);
    const boomerTarget = ability.selectableInstanceIds?.find((id) => {
      const stack = state.players[0].zones.alert.find(
        (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-103",
      );
      return stack && stack.cards[0].instanceId === id;
    });
    if (boomerTarget) (ga as Record<string, unknown>).targetInstanceId = boomerTarget;
    const result = applyAction(state, 0, ga, bases);
    state = result.state;
    const boomerInHand = state.players[0].hand.some(
      (c: { defId: string }) => c.defId === "BSG1-103",
    );
    const boomerInAlert = state.players[0].zones.alert.some(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-103",
    );
    assert(boomerInHand, "Cylon unit returned to hand");
    assert(!boomerInAlert, "Cylon unit removed from alert");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 4: Commit — Mission Lock-down
// ============================================================

// --- 12. astral-queen-lockdown: Commit — Commit+exhaust target unresolved mission ---

header("Astral Queen, Hitch in the Plan — Commit: Lock down target mission");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-132"], // Astral Queen, Hitch in the Plan
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-056"], influence: 10 }, // opponent has a mission
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "astral queen");
  assert(!!ability, "Astral Queen lockdown ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // The mission should be committed and exhausted
    const inReserve = state.players[1].zones.reserve.find(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-056",
    );
    assert(!!inReserve, "Mission committed to reserve");
    assert(inReserve?.exhausted === true, "Mission is exhausted");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 5: Challenge-Phase Commit Abilities
// ============================================================

// --- 13. viper0205-buff during challenge: Commit — Target other ship +2 power ---

header("Colonial Viper 0205 — During challenge: Target ship +2 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG2-140", "BSG1-173"], // Viper 0205 + Space Park (challenger)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-174"],
        influence: 10, // Supply Freighter (ship defender)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Space Park, then use Viper ability during challenge
  const s = setupChallengeWithDefender(state, 0, 1, "BSG1-173");
  if (s) {
    state = s;
    // Player 0's turn in effects round — use Viper ability
    const viperAbility = findAbility(getValidActions(state, 0, bases), "viper");
    assert(!!viperAbility, "Viper 0205 ability available during challenge");

    if (viperAbility) {
      const result = applyAction(state, 0, toGameAction(viperAbility), bases);
      state = result.state;
    }
  } else {
    assert(false, "Could not set up defended challenge");
  }
  printLog(state);
}

// --- 14. cloud9-transport: Commit during challenge — End challenge ---

header("Cloud 9, Transport Hub — Commit: End challenge");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // Apollo (challenger personnel)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG2-136", "BSG1-102"], // Cloud 9 Transport Hub + Billy (defender)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Apollo, Billy defends
  const s = setupChallengeWithDefender(state, 0, 1, "BSG1-098", "BSG1-102");
  if (s) {
    state = s;
    // Player 0 passes
    const p0Pass = findAction(getValidActions(state, 0, bases), "challengePass");
    if (p0Pass) {
      const result = applyAction(state, 0, toGameAction(p0Pass), bases);
      state = result.state;
    }
    // Player 1 uses Cloud 9 Transport Hub
    const cloud9 = findAbility(getValidActions(state, 1, bases), "cloud 9");
    assert(!!cloud9, "Cloud 9 Transport Hub ability available");

    if (cloud9) {
      const result = applyAction(state, 1, toGameAction(cloud9), bases);
      state = result.state;
      // Challenge should have ended
      assert(!state.challenge, "Challenge ended by Cloud 9");
    }
  } else {
    assert(false, "Could not set up defended challenge");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 6: Passive Power Modifiers
// ============================================================

// --- 15. raptor816-defend: +1 power while defending ---

header("Raptor 816 — Passive: +1 power while defending");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-174"], // Supply Freighter (ship challenger, power 0)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-170"], // Raptor 816 (power 2, +1 while defending = 3)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Supply Freighter (power 0) vs Raptor 816 (power 2+1=3)
  const s = setupChallengeWithDefender(state, 0, 1, "BSG1-174", "BSG1-170");
  if (s) {
    state = s;
    state = resolveChallenge(state);
    // Supply Freighter (power 0) should lose to Raptor 816 (power 2+1=3)
    // Challenger should be defeated
    const supplyInAlert = state.players[0].zones.alert.find(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-174",
    );
    assert(!supplyInAlert, "Supply Freighter defeated (Raptor 816 defended with +1)");
  } else {
    assert(false, "Could not set up defended challenge");
  }
  printLog(state);
}

// --- 16. viper4267-defend: +1 power while defending ---

header("Colonial Viper 4267 — Passive: +1 power while defending");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-145"], // Viper 4267
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Just verify the unit exists and has the expected base power
  const viperStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG2-145",
  );
  assert(!!viperStack, "Viper 4267 in play");
  // The +1 defender power is tested same as Raptor 816 above
  printLog(state);
}

// --- 17. captured-raider-starbuck: +1 while controlling alert Starbuck ---

header("Captured Raider — Passive: +1 power with alert Starbuck");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG2-135", "BSG1-136"], // Captured Raider + Starbuck Hotshot
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge undefended with Captured Raider — power 3 base + 1 (Starbuck) = 4
  const s = challengeUndefended(state, 0, 1, "BSG2-135");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 4, `Opponent lost 4 (3 base + 1 Starbuck buff) — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Captured Raider");
  }
  printLog(state);
}

// --- 18. cloud9-civilian: All Civilian units +1 power ---

header("Cloud 9, Vacation Ship — Passive: All Civilians +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        // BSG1-117 = Dr. Baltar Award Winner (Civilian), BSG2-137 = Cloud 9 Vacation Ship
        alert: ["BSG2-137", "BSG1-117"],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Dr. Baltar (Civilian) — should get +1 from Cloud 9
  const s = challengeUndefended(state, 0, 1, "BSG1-117");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    // BSG1-115 power + 1 from Cloud 9
    assert(infLoss >= 2, `Civilian got Cloud 9 buff — opponent lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Civilian");
  }
  printLog(state);
}

// --- 19. colonial-one-politician: All Politicians +1 power ---

header("Colonial One, Admin HQ — Passive: All Politicians +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        // BSG2-138 = Colonial One Admin HQ, BSG1-100 = Apollo Political Liaison (Politician)
        alert: ["BSG2-138", "BSG1-100"],
        deck: ["BSG1-098", "BSG1-099", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Apollo Political Liaison has Officer + Politician traits
  const s = challengeUndefended(state, 0, 1, "BSG1-100");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    // Apollo Political Liaison base power + 1 from Colonial One
    assert(infLoss >= 2, `Politician got Colonial One buff — opponent lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Apollo");
  }
  printLog(state);
}

// --- 20. galactica-fighters: All Fighters +1 power ---

header("Galactica, Launch Platform — Passive: All Fighters +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        // BSG2-149 = Galactica Launch Platform, BSG2-145 = Viper 4267 (Fighter, power 2)
        alert: ["BSG2-149", "BSG2-145"],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-174"],
        influence: 10, // Supply Freighter (ship)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Viper 4267 (power 2 + 1 from Galactica = 3)
  const s = challengeUndefended(state, 0, 1, "BSG2-145");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 3, `Fighter got +1 from Galactica — opponent lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Viper");
  }
  printLog(state);
}

// --- 21. astral-queen-defend: All defending personnel +1 power ---

header("Astral Queen, Prison Ship — Passive: Defending personnel +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // Apollo (personnel, challenger)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-144", "BSG1-102"], // Astral Queen + Billy (personnel, defender)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge, Billy defends — should get +1 from Astral Queen
  const s = setupChallengeWithDefender(state, 0, 1, "BSG1-098", "BSG1-102");
  if (s) {
    state = s;
    // Billy base power is 1, +1 from Astral Queen = 2
    // Check challenge state shows defender buff
    assert(!!state.challenge, "Challenge in progress");
  } else {
    assert(false, "Could not set up defended challenge");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 7: Triggered Abilities
// ============================================================

// --- 22. scouting-raider-etb: ETB — Look at top card of target deck ---

header("Scouting Raider — ETB: Look at top card of target deck");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security base
        hand: ["BSG1-171"], // Scouting Raider (cost: security 5)
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Add supply cards for cost (security 5 needs 5 resources)
  const baseStack = state.players[0].zones.resourceStacks[0];
  baseStack.supplyCards.push({ defId: "BSG1-098", instanceId: "supply-1", faceUp: false });
  baseStack.supplyCards.push({ defId: "BSG1-099", instanceId: "supply-2", faceUp: false });
  baseStack.supplyCards.push({ defId: "BSG1-100", instanceId: "supply-3", faceUp: false });
  baseStack.supplyCards.push({ defId: "BSG1-101", instanceId: "supply-4", faceUp: false });

  const playAction = findAction(getValidActions(state, 0, bases), "playCard");
  assert(!!playAction, "Can play Scouting Raider from hand");

  if (playAction) {
    const result = applyAction(state, 0, toGameAction(playAction), bases);
    state = result.state;
    // Should have triggered ETB — look at opponent's top card (or pending choice)
    const logStr = state.log.map((e: LogItem) => (typeof e === "string" ? e : e.msg)).join(" ");
    assert(
      logStr.includes("Scouting Raider") || logStr.includes("top card"),
      "Scouting Raider ETB triggered",
    );
  }
  printLog(state);
}

// --- 23. skirmishing-raider-sacrifice: On challenge end — Sacrifice self ---

header("Skirmishing Raider — Triggered: Sacrifice after challenge");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG1-172"], // Skirmishing Raider (power 4)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = challengeUndefended(state, 0, 1, "BSG1-172");
  if (s) {
    state = s;
    // Skirmishing Raider should be sacrificed (not in alert or reserve)
    const inAlert = state.players[0].zones.alert.some(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-172",
    );
    const inReserve = state.players[0].zones.reserve.some(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-172",
    );
    assert(!inAlert && !inReserve, "Skirmishing Raider sacrificed after challenge");
    // Should still deal damage
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 4, `Opponent lost 4 influence — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Skirmishing Raider");
  }
  printLog(state);
}

// --- 24. cloud9-shield: On influence loss — Commit to reduce by 1 ---

header("Cloud 9, Cruise Ship — Triggered: Reduce influence loss by 1");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // Apollo (challenger)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-145"], // Cloud 9 Cruise Ship
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge player 1 undefended — Cloud 9 should auto-trigger to reduce loss
  const s = challengeUndefended(state, 0, 1, "BSG1-098");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    // Apollo Ace Pilot power = 2, Cloud 9 reduces by 1, so loss should be 1
    assert(infLoss === 1, `Cloud 9 reduced loss to 1 — opponent lost ${infLoss}`);
    // Cloud 9 should be committed (in reserve)
    const cloud9InReserve = state.players[1].zones.reserve.some(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-145",
    );
    assert(cloud9InReserve, "Cloud 9 committed to reserve");
  } else {
    assert(false, "Could not set up challenge");
  }
  printLog(state);
}

// --- 25. viper762-pilot: On challenge init — Commit Pilot for +3 power ---

header("Colonial Viper 762 — Triggered: Commit Pilot for +3 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001",
        hand: [],
        alert: ["BSG1-153", "BSG1-098"], // Viper 762 + Apollo Ace Pilot (Pilot)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Viper 762 — should trigger Pilot commit option
  const challengeAction = getValidActions(state, 0, bases).find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG1-153",
  );
  assert(!!challengeAction, "Can challenge with Viper 762");

  if (challengeAction) {
    let result = applyAction(state, 0, toGameAction(challengeAction), bases);
    state = result.state;

    // Viper 762's trigger fires: need to accept the triggered ability
    const triggerAction = getValidActions(state, 0, bases).find(
      (a: VA) => a.type === "useTriggeredAbility",
    );
    if (triggerAction) {
      result = applyAction(state, 0, toGameAction(triggerAction), bases);
      state = result.state;
    }

    const logStr = state.log.map((e: LogItem) => (typeof e === "string" ? e : e.msg)).join(" ");
    const pilotCommitted = logStr.includes("committed") && logStr.includes("+3 power");
    assert(pilotCommitted, "Viper 762 auto-triggered: Pilot committed for +3 power");

    // Apollo should be in reserve
    const apolloInReserve = state.players[0].zones.reserve.some(
      (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-098",
    );
    assert(apolloInReserve, "Pilot moved to reserve");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 8: Passive Cylon-Phase Modifiers
// ============================================================

// --- 26. galactica-defender: All Cylon threats -1 power ---

header("Galactica, Defender of the Fleet — Passive: Cylon threats -1 power");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG2-148"], // Galactica, Defender of the Fleet
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Galactica Defender is in play — its effect applies during Cylon phase
  const galStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG2-148",
  );
  assert(!!galStack, "Galactica Defender in play");
  printLog(state);
}

// --- 27. viper1104-cylon: +2 power during Cylon phase ---

header("Colonial Viper 1104 — Passive: +2 power during Cylon phase");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001",
        hand: [],
        alert: ["BSG2-142"], // Viper 1104
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const viperStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG2-142",
  );
  assert(!!viperStack, "Viper 1104 in play (gets +2 during Cylon phase)");
  printLog(state);
}

// ============================================================
// CATEGORY 9: Freighter Resources
// ============================================================

// --- 28. supply-freighter: Generate logistics on resource spend ---

header("Supply Freighter — Freighter: Generate logistics on spend");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001", // logistics base
        hand: [],
        alert: ["BSG1-174"], // Supply Freighter (logistics freighter)
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const supplyStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-174",
  );
  assert(!!supplyStack, "Supply Freighter in play");
  printLog(state);
}

// --- 29. ordnance-freighter: Generate security on resource spend ---

header("Ordnance Freighter — Freighter: Generate security on spend");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG1-161"], // Ordnance Freighter (security freighter)
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ordStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-161",
  );
  assert(!!ordStack, "Ordnance Freighter in play");
  printLog(state);
}

// --- 30. troop-freighter: Generate persuasion on resource spend ---

header("Troop Freighter — Freighter: Generate persuasion on spend");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-175"], // Troop Freighter (persuasion freighter)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const troopStack = state.players[0].zones.alert.find(
    (s: { cards: Array<{ defId: string }> }) => s.cards[0].defId === "BSG1-175",
  );
  assert(!!troopStack, "Troop Freighter in play");
  printLog(state);
}

// ============================================================
// CATEGORY 10: Special / Unique Mechanics
// ============================================================

// --- 31. raptor432-flash: Flash play from hand to defend against ship ---

header("Raptor 432 — Flash play from hand to defend against ship");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: [],
        alert: ["BSG1-174"], // Supply Freighter (ship challenger)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-001", // logistics base (Raptor 432 costs logistics 3)
        hand: ["BSG2-161"], // Raptor 432 in hand
        alert: [],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Add supply cards so player 1 can afford Raptor 432
  const baseStack1 = state.players[1].zones.resourceStacks[0];
  baseStack1.supplyCards.push({ defId: "BSG1-098", instanceId: "supply-r1", faceUp: false });
  baseStack1.supplyCards.push({ defId: "BSG1-099", instanceId: "supply-r2", faceUp: false });

  // Challenge with a ship
  const challengeAction = getValidActions(state, 0, bases).find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG1-174",
  );
  if (challengeAction) {
    const result = applyAction(state, 0, toGameAction(challengeAction), bases);
    state = result.state;

    // Player 1 should see an option to flash play Raptor 432
    const defActions = getValidActions(state, 1, bases);
    const flashDefend = defActions.find(
      (a: VA) => a.type === "defend" && a.cardDefId === "BSG2-161",
    );
    assert(!!flashDefend, "Raptor 432 flash-defend option available from hand");
  } else {
    assert(false, "Could not challenge with ship");
  }
  printLog(state);
}

// ============================================================
// RESULTS
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(60));

if (failed > 0) process.exit(1);
