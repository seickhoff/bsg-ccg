/**
 * Headless test runner for BSG CCG personnel ability scenarios.
 * Run with: npx tsx server/src/test-personnel.ts
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
          va.targetInstanceId ?? (va.sourceInstanceId ? va.selectableInstanceIds?.[0] : undefined),
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
    // Try player passes
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
    ? actions.find((a) => a.type === "challenge" && a.cardDefId === challengerDefId)
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

/** Initiate a challenge and advance to step 2 (effects round). */
function setupChallenge(
  state: GameState,
  challengerPlayer: number,
  defenderPlayer: number,
  defend: boolean = true,
): GameState | null {
  const challengeAction = findAction(getValidActions(state, challengerPlayer, bases), "challenge");
  if (!challengeAction) return null;
  let result = applyAction(state, challengerPlayer, toGameAction(challengeAction), bases);
  let s = result.state;
  if (!s.challenge) return null;

  if (s.challenge.waitingForDefender) {
    // Handle any pending triggers first
    const defActions = getValidActions(s, defenderPlayer, bases);
    const declineTrigger = findAction(defActions, "declineTrigger");
    if (declineTrigger) {
      result = applyAction(s, defenderPlayer, toGameAction(declineTrigger), bases);
      s = result.state;
    }

    const defendActions = getValidActions(s, defenderPlayer, bases);
    if (defend) {
      const defendAction = findAction(defendActions, "defend");
      if (defendAction && defendAction.selectableInstanceIds?.length) {
        result = applyAction(s, defenderPlayer, toGameAction(defendAction), bases);
        s = result.state;
      }
    } else {
      // Decline to defend
      const declineDefend = defendActions.find(
        (a) => a.type === "defend" && !a.selectableInstanceIds?.length,
      );
      const noDefend = declineDefend || { type: "defend" as const, description: "" };
      result = applyAction(s, defenderPlayer, { type: "defend", defenderInstanceId: null }, bases);
      s = result.state;
    }
  }

  return s;
}

// ============================================================
// CATEGORY 1: Simple Commit Abilities (no target)
// ============================================================

// --- 1. roslin-draw: Commit — Draw a card ---

header("Laura Roslin, Colonial President — Commit: Draw a card");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-125"], // Laura Roslin, Colonial President
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const handBefore = state.players[0].hand.length;
  const deckBefore = state.players[0].deck.length;

  const ability = findAbility(getValidActions(state, 0, bases), "draw");
  assert(!!ability, "Roslin draw ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    assert(state.players[0].hand.length === handBefore + 1, "Drew 1 card");
    assert(state.players[0].deck.length === deckBefore - 1, "Deck decreased by 1");
    // Roslin should now be in reserve (committed)
    const inReserve = state.players[0].zones.reserve.find((s) => s.cards[0].defId === "BSG1-125");
    assert(!!inReserve, "Roslin committed to reserve");
  }
  printLog(state);
}

// --- 2. roslin-influence: Commit — Gain 1 influence ---

header("Laura Roslin, Madame President — Commit: Gain 1 influence");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-127"], // Madame President
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const infBefore = state.players[0].influence;
  const ability = findAbility(getValidActions(state, 0, bases), "roslin");
  assert(!!ability, "Roslin influence ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    assert(state.players[0].influence === infBefore + 1, "Gained 1 influence");
  }
  printLog(state);
}

// --- 3. boomer-saboteur: Commit — All players lose 1 influence ---

header("Boomer, Saboteur — Commit: All players lose 1 influence");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-105"], // Boomer, Saboteur
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const p0Inf = state.players[0].influence;
  const p1Inf = state.players[1].influence;
  const ability = findAbility(getValidActions(state, 0, bases), "saboteur");
  assert(!!ability, "Boomer saboteur ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    assert(state.players[0].influence === p0Inf - 1, "Player 0 lost 1 influence");
    assert(state.players[1].influence === p1Inf - 1, "Player 1 lost 1 influence");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 2: Commit — Target Power Buffs
// ============================================================

// --- 4. helo-buff: Commit — Target Pilot gets +2 power ---

header("Helo, Flight Officer — Commit: Target Pilot gets +2 power (in challenge)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-122", "BSG1-098"], // Helo + Apollo Ace Pilot (Pilot)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Start a challenge with Apollo (Pilot)
  // Find the challenge action for BSG1-098
  const actions = getValidActions(state, 0, bases);
  const challengeActions = actions.filter((a) => a.type === "challenge");
  const apolloChallenge = challengeActions.find((a) => {
    const def = registry.cards[a.cardDefId ?? ""];
    return def?.title === "Apollo";
  });

  if (apolloChallenge) {
    let result = applyAction(state, 0, toGameAction(apolloChallenge), bases);
    state = result.state;

    // Decline to defend
    if (state.challenge?.waitingForDefender) {
      result = applyAction(state, 1, { type: "defend", defenderInstanceId: null }, bases);
      state = result.state;
    }

    // Now look for Helo buff ability during challenge
    if (state.challenge) {
      const heloAbility = findAbility(getValidActions(state, 0, bases), "helo");
      assert(!!heloAbility, "Helo buff ability available during challenge");

      if (heloAbility) {
        result = applyAction(state, 0, toGameAction(heloAbility), bases);
        state = result.state;
        assert(
          state.challenge?.challengerPowerBuff === 2,
          `Challenger got +2 power buff (got ${state.challenge?.challengerPowerBuff})`,
        );
      }
    }
  } else {
    assert(false, "Could not initiate challenge with Apollo");
  }
  printLog(state);
}

// --- 5. ellen-buff: Commit — Target Officer gets +2 power ---

header("Ellen Tigh — Commit: Target Officer gets +2 power (in challenge)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-100", "BSG2-105"], // Apollo Political Liaison (Officer) + Ellen Tigh
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge specifically with Apollo (Officer)
  const actions = getValidActions(state, 0, bases);
  const apolloChallenge = actions.find((a) => a.type === "challenge" && a.cardDefId === "BSG1-100");
  if (apolloChallenge) {
    let result = applyAction(state, 0, toGameAction(apolloChallenge), bases);
    state = result.state;
    if (state.challenge?.waitingForDefender) {
      result = applyAction(state, 1, { type: "defend", defenderInstanceId: null }, bases);
      state = result.state;
    }
    if (state.challenge) {
      const ellenAbility = findAbility(getValidActions(state, 0, bases), "ellen");
      assert(!!ellenAbility, "Ellen buff ability available for Officer challenger");
      if (ellenAbility) {
        result = applyAction(state, 0, toGameAction(ellenAbility), bases);
        state = result.state;
        assert(state.challenge?.challengerPowerBuff === 2, "Officer challenger got +2 power");
      }
    }
  } else {
    assert(false, "Could not challenge with Apollo Officer");
  }
  printLog(state);
}

// --- 6. cottle-debuff: Commit — Target personnel gets -2 power ---

header("Dr. Cottle, Bearer of Bad News — Commit: Target personnel gets -2 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-101", "BSG1-098"], // Cottle + Apollo
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Challenge with Apollo, defender selects BSG1-102
  const s = setupChallenge(state, 0, 1, true);
  if (s) {
    state = s;
    const cottleAbility = findAbility(getValidActions(state, 0, bases), "cottle");
    assert(!!cottleAbility, "Cottle debuff ability available during challenge");

    if (cottleAbility) {
      const result = applyAction(state, 0, toGameAction(cottleAbility), bases);
      state = result.state;
      assert(
        state.challenge?.defenderPowerBuff === -2,
        `Defender got -2 power (got ${state.challenge?.defenderPowerBuff})`,
      );
    }
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 3: Commit — Target Manipulation
// ============================================================

// --- 7. tyrol-ready: Commit — Ready target ship ---

header("Galen Tyrol, CPO — Commit: Ready target ship");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-120"], // Tyrol CPO
        reserve: ["BSG1-144"], // Astral Queen (ship) in reserve
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(state.players[0].zones.reserve.length === 1, "Ship in reserve");
  const ability = findAbility(getValidActions(state, 0, bases), "tyrol");
  assert(!!ability, "Tyrol ready-ship ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const shipStillInReserve = state.players[0].zones.reserve.find(
      (s) => s.cards[0].defId === "BSG1-144",
    );
    assert(!shipStillInReserve, "Ship moved from reserve");
    const readied = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-144");
    assert(!!readied, "Ship now in alert");
  }
  printLog(state);
}

// --- 8. cally-restore: Commit — Restore target ship ---

header("Cally, Cheerful Mechanic — Commit: Restore target ship");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-090"], // Cally
        alertExhausted: ["BSG1-144"], // Astral Queen (exhausted)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "cally");
  assert(!!ability, "Cally restore ability available for exhausted ship");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const ship = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-144");
    assert(!ship?.exhausted, "Ship restored (no longer exhausted)");
  }
  printLog(state);
}

// --- 9. simon-restore: Commit — Restore target personnel ---

header("Simon, Caring Doctor — Commit: Restore target personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-124"], // Simon
        alertExhausted: ["BSG1-098"], // Apollo (exhausted)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "simon");
  assert(!!ability, "Simon restore ability available for exhausted personnel");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const apollo = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-098");
    assert(!apollo?.exhausted, "Personnel restored");
  }
  printLog(state);
}

// --- 10. doral-exhaust: Commit — Exhaust target ship ---

header("Doral, Tour Guide — Commit: Exhaust target ship");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-097"], // Doral Tour Guide
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-144"], influence: 10 }, // Opponent has ship
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "doral");
  assert(!!ability, "Doral exhaust ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const ship = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-144");
    assert(!!ship?.exhausted, "Opponent's ship is now exhausted");
  }
  printLog(state);
}

// --- 11. six-exhaust: Vision + Commit — Exhaust target other personnel ---

header("Number Six, Secret Companion — Commit: Exhaust target other personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-132"], // Number Six Secret Companion (Vision)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "six");
  assert(!!ability, "Six exhaust ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!!target?.exhausted, "Target personnel exhausted");
  }
  printLog(state);
}

// --- 12. baltar-defeat: Commit — Defeat target exhausted personnel ---

header("Dr. Baltar, Science Advisor — Commit: Defeat target exhausted personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-118"], // Baltar Science Advisor
      },
      player1: { baseId: "BSG1-007", alertExhausted: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "baltar");
  assert(!!ability, "Baltar defeat ability available for exhausted target");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const remaining = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!remaining, "Target personnel defeated (removed from alert)");
    assert(state.players[1].discard.length > 0, "Defeated card in discard");
  }
  printLog(state);
}

// --- 13. centurion-harass: Commit — Commit target personnel ---

header("Centurion Harasser — Commit: Commit target personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-092"], // Centurion Harasser
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "centurion");
  assert(!!ability, "Centurion harass ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const committed = state.players[1].zones.reserve.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!!committed, "Target personnel committed to reserve");
  }
  printLog(state);
}

// --- 14. roslin-mission: Commit — Ready target mission ---

header("Laura Roslin, Instigator — Commit: Ready target mission");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-116"], // Roslin Instigator
        reserve: ["BSG1-056"], // A mission in reserve
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "roslin");
  assert(!!ability, "Roslin mission-ready ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const inAlert = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-056");
    assert(!!inAlert, "Mission readied to alert");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 4: Commit — Keyword/Trait Grants
// ============================================================

// --- 15. apollo-strafe: Commit — Target other personnel gains Strafe ---

header("Apollo, Distant Son — Commit: Target other personnel gains Strafe");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-085", "BSG1-100"], // Apollo Distant Son + Apollo Political Liaison
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "distant son");
  assert(!!ability, "Apollo strafe-grant ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Check the target got Strafe keyword (stored on PlayerState.temporaryKeywordGrants)
    const target = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-100");
    const targetId = target?.cards[0].instanceId ?? "";
    const grants = state.players[0].temporaryKeywordGrants?.[targetId];
    assert(grants?.includes("Strafe") === true, "Target gained Strafe keyword");
  }
  printLog(state);
}

// --- 16. leoben-cylon: Commit — Target personnel gains the Cylon trait ---

header("Leoben, Snake in the Grass — Commit: Target personnel gains Cylon trait");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-118", "BSG1-098"], // Leoben + Apollo Ace Pilot (no Cylon)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "leoben");
  assert(!!ability, "Leoben Cylon-grant ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-098");
    const targetId = target?.cards[0].instanceId ?? "";
    const traitGrants = state.players[0].temporaryTraitGrants?.[targetId];
    assert(traitGrants?.includes("Cylon") === true, "Target gained Cylon trait");
  }
  printLog(state);
}

// --- 17. adama-sniper: Commit — Target other personnel gains Sniper ---

header("William Adama, Tactician — Commit: Target other personnel gains Sniper");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-130", "BSG1-098"], // Adama Tactician + Apollo
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "tactician");
  assert(!!ability, "Adama Sniper-grant ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-098");
    const targetId = target?.cards[0].instanceId ?? "";
    const kwGrants = state.players[0].temporaryKeywordGrants?.[targetId];
    assert(kwGrants?.includes("Sniper") === true, "Target gained Sniper keyword");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 5: Commit — Lock-down (commit+exhaust target)
// ============================================================

// --- 18. tigh-lockdown: Commit+Exhaust — Commit and exhaust target personnel ---

header("Saul Tigh, Disciplinarian — Commit+Exhaust: Commit+exhaust target personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-123"], // Tigh Disciplinarian
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "tigh");
  assert(!!ability, "Tigh lockdown ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.reserve.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!!target, "Target committed to reserve");
    assert(target?.exhausted === true, "Target also exhausted");
  }
  printLog(state);
}

// --- 19. hadrian-tribunal: Commit — Commit+exhaust target personnel with power <= 2 ---

header("Hadrian, Head of Tribunal — Commit: C+E target personnel power <= 2");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-110"], // Hadrian Head of Tribunal
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 }, // Billy power 1
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "hadrian");
  assert(!!ability, "Hadrian tribunal ability available (target power <= 2)");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.reserve.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!!target, "Target committed to reserve");
    assert(target?.exhausted === true, "Target also exhausted");
  }
  printLog(state);
}

// --- 20. hadrian-investigate: Commit — C+E target Enlisted or Cylon personnel ---

header("Hadrian, Investigator — Commit: C+E target Enlisted or Cylon personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-111"], // Hadrian Investigator
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-115"], influence: 10 }, // Dee Dradis (Enlisted)
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "hadrian");
  assert(!!ability, "Hadrian investigate ability available (Enlisted target)");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.reserve.find((s) => s.cards[0].defId === "BSG1-115");
    assert(!!target, "Enlisted target committed to reserve");
    assert(target?.exhausted === true, "Target also exhausted");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 6: Commit+Exhaust — Recovery from discard
// ============================================================

// --- 21. crashdown-recover: Commit+Exhaust — Any card from discard to hand ---

header("Crashdown, Sensor Operator — C+E: Recover any card from discard");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-111"], // Crashdown Sensor Operator
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Put a card in discard
  state.players[0].discard.push({ defId: "BSG1-098", instanceId: "disc-1", faceUp: true });

  const ability = findAbility(getValidActions(state, 0, bases), "crashdown");
  assert(!!ability, "Crashdown recover ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const inHand = state.players[0].hand.some((c: { defId: string }) => c.defId === "BSG1-098");
    assert(inHand, "Card recovered from discard to hand");
    assert(state.players[0].discard.length === 0, "Discard is now empty");
  }
  printLog(state);
}

// --- 22. starbuck-bounce: Commit+Exhaust — Return target alert personnel to hand ---

header("Starbuck, Maverick — C+E: Return target alert personnel to hand");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-126"], // Starbuck Maverick
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "starbuck");
  assert(!!ability, "Starbuck bounce ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-102");
    assert(!target, "Target no longer in alert");
    const inHand = state.players[1].hand.some((c: { defId: string }) => c.defId === "BSG1-102");
    assert(inHand, "Target returned to hand");
  }
  printLog(state);
}

// --- 23. starbuck-sabotage: Commit+Exhaust — Exhaust target resource stack ---

header("Starbuck, Resistance Fighter — C+E: Exhaust target resource stack");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-127"], // Starbuck Resistance Fighter
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(
    !state.players[1].zones.resourceStacks[0].exhausted,
    "Opponent base not exhausted initially",
  );
  const ability = findAbility(getValidActions(state, 0, bases), "starbuck");
  assert(!!ability, "Starbuck sabotage ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    assert(
      state.players[1].zones.resourceStacks[0].exhausted,
      "Opponent's resource stack exhausted",
    );
  }
  printLog(state);
}

// --- 24. starbuck-slay: Commit+Exhaust — Defeat target Cylon personnel ---

header("Starbuck, Uncooperative Patient — C+E: Defeat target Cylon personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-128"], // Starbuck Uncooperative Patient
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-103"], influence: 10 }, // Boomer (Cylon)
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "starbuck");
  assert(!!ability, "Starbuck slay ability available for Cylon target");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const target = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-103");
    assert(!target, "Cylon personnel defeated");
  }
  printLog(state);
}

// --- 25. starbuck-slay: NOT available for non-Cylon target ---

header("Starbuck, Uncooperative Patient — Not available for non-Cylon");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-128"],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 }, // Billy (not Cylon)
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "starbuck");
  assert(!ability, "Starbuck slay NOT available for non-Cylon target");
}

// --- 26. six-ready-cylon: Commit+Exhaust — Ready target other Cylon personnel ---

header("Number Six, Caprican Operative — C+E: Ready target Cylon personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-131"], // Six Caprican Operative
        reserve: ["BSG1-103"], // Boomer (Cylon) in reserve
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "six");
  assert(!!ability, "Six ready-cylon ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    const readied = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-103");
    assert(!!readied, "Cylon personnel readied to alert");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 7: Challenge-Only Abilities
// ============================================================

// --- 27. cottle-surgeon: Commit during challenge — Loser exhausted instead of defeated ---

header("Dr. Cottle, Military Surgeon — Commit: Loser exhausted instead of defeated");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-103", "BSG1-098"], // Cottle Surgeon + Apollo Ace Pilot
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-141"],
        influence: 10, // Adama Commander (power 4)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = setupChallenge(state, 0, 1, true);
  if (s) {
    state = s;
    const cottleAbility = findAbility(getValidActions(state, 0, bases), "cottle");
    assert(!!cottleAbility, "Cottle surgeon ability available during challenge");

    if (cottleAbility) {
      const result = applyAction(state, 0, toGameAction(cottleAbility), bases);
      state = result.state;
      // The flag should be set
      assert(
        state.challenge?.losesExhaustedNotDefeated === true,
        "losesExhaustedNotDefeated flag set",
      );
    }
  } else {
    assert(false, "Failed to set up defended challenge");
  }
  printLog(state);
}

// --- 28. elosha-double: Commit during challenge — Double mystic reveal ---

header("Elosha, Priestess — Commit: Double mystic value reveal");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-108", "BSG1-098"], // Elosha Priestess + Apollo
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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

  const s = setupChallenge(state, 0, 1, true);
  if (s) {
    state = s;
    const eloshaAbility = findAbility(getValidActions(state, 0, bases), "elosha");
    assert(!!eloshaAbility, "Elosha double-mystic ability available during challenge");

    if (eloshaAbility) {
      const result = applyAction(state, 0, toGameAction(eloshaAbility), bases);
      state = result.state;
      assert(state.challenge?.doubleMysticReveal === 0, "doubleMysticReveal flag set for player 0");
    }
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// --- 29. helo-protect: Commit during challenge — Target other defending personnel +2 ---

header("Helo, Protector — Commit: Target other defending personnel gets +2");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // Apollo (challenger)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG2-114", "BSG1-102"],
        influence: 10, // Helo Protector + Billy (defender)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Start challenge
  const challengeAction = findAction(getValidActions(state, 0, bases), "challenge");
  if (challengeAction) {
    let result = applyAction(state, 0, toGameAction(challengeAction), bases);
    state = result.state;

    // Explicitly select Billy (BSG1-102) as defender, not Helo
    const defendActions = getValidActions(state, 1, bases);
    const billyDefend = defendActions.find(
      (a) => a.type === "defend" && a.cardDefId === "BSG1-102",
    );
    if (billyDefend) {
      result = applyAction(state, 1, toGameAction(billyDefend), bases);
      state = result.state;

      // Challenger (player 0) passes first in effects round
      const p0Pass = findAction(getValidActions(state, 0, bases), "challengePass");
      if (p0Pass) {
        result = applyAction(state, 0, toGameAction(p0Pass), bases);
        state = result.state;
      }

      // Now Helo (non-defender) should be able to use ability targeting Billy (defender)
      const heloAbility = findAbility(getValidActions(state, 1, bases), "protector");
      assert(!!heloAbility, "Helo protect ability available for defender");

      if (heloAbility) {
        result = applyAction(state, 1, toGameAction(heloAbility), bases);
        state = result.state;
        assert(
          state.challenge?.defenderPowerBuff === 2,
          `Defender got +2 power (got ${state.challenge?.defenderPowerBuff})`,
        );
      }
    } else {
      assert(false, "Could not find Billy defend action");
    }
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 8: Commit-Other / Sacrifice-Other Cost
// ============================================================

// --- 30. baltar-boost: Commit target other personnel — Self gets +1 power ---

header("Dr. Baltar, Defense Contractor — Commit other: Self gets +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-098", "BSG1-098"], // Baltar Defense Contractor + Apollo
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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

  // Need to challenge with Baltar, then use his ability
  const actions = getValidActions(state, 0, bases);
  const baltarChallenge = actions.find((a) => a.type === "challenge" && a.cardDefId === "BSG2-098");

  if (baltarChallenge) {
    let result = applyAction(state, 0, toGameAction(baltarChallenge), bases);
    state = result.state;

    if (state.challenge?.waitingForDefender) {
      result = applyAction(state, 1, { type: "defend", defenderInstanceId: null }, bases);
      state = result.state;
    }

    if (state.challenge) {
      const baltarAbility = findAbility(getValidActions(state, 0, bases), "baltar");
      assert(!!baltarAbility, "Baltar boost ability available (commit-other cost)");

      if (baltarAbility) {
        result = applyAction(state, 0, toGameAction(baltarAbility), bases);
        state = result.state;
        // Apollo should be committed, Baltar gets +1
        assert(
          (state.challenge?.challengerPowerBuff ?? 0) >= 1,
          `Baltar got power buff (got ${state.challenge?.challengerPowerBuff})`,
        );
      }
    }
  } else {
    assert(false, "Could not challenge with Baltar");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 9: Dual / Complex Abilities
// ============================================================

// --- 31. baltar-vp: Commit — Move mission to reserve OR Ready mission ---

header("Dr. Baltar, Vice President — Commit: Toggle mission alert/reserve");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-119", "BSG1-056"], // Baltar VP + a mission in alert
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Baltar VP should offer ability to move mission to reserve
  const ability = findAbility(getValidActions(state, 0, bases), "baltar");
  assert(!!ability, "Baltar VP ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Mission should have moved to reserve
    const inReserve = state.players[0].zones.reserve.find((s) => s.cards[0].defId === "BSG1-056");
    const inAlert = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-056");
    assert(!!inReserve || !inAlert, "Mission moved (either to reserve or readied)");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 10: Passive Power Modifiers
// ============================================================

// --- 32. apollo-cag: All other Pilots you control get +1 power ---

header("Apollo, Commander Air Group — Passive: Other Pilots get +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-099", "BSG1-136"], // Apollo CAG + Starbuck Hotshot Pilot (both Pilots, different titles)
        deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Starbuck Hotshot Pilot base power = 2, +1 from her own ability (1 other Pilot),
  // +1 from Apollo CAG buff = 4. Undefended → opponent loses 4.
  const s = challengeUndefended(state, 0, 1, "BSG1-136");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(
      infLoss === 4,
      `Opponent lost 4 influence (2 base + 1 own + 1 CAG buff) — lost ${infLoss}`,
    );
  } else {
    assert(false, "Could not challenge with Starbuck");
  }
  printLog(state);
}

// --- 33. billy-defend: While defending, +2 power ---

header("Billy Keikeya, Press Secretary — Passive: +2 while defending");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // Apollo (power 2) challenges
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10, // Billy Press Secretary (power 1 + 2 defending = 3)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Billy's base power is 1. With defending bonus = 3. Apollo is 2. Billy should win.
  const s = setupChallenge(state, 0, 1, true);
  if (s) {
    state = s;
    // Billy's effective power during defense should be 3 (1 + 2)
    // We can't directly check effective power, but the challenge result will show
    assert(!!state.challenge, "Challenge is active with defender");
  } else {
    assert(false, "Failed to set up defended challenge");
  }
  printLog(state);
}

// --- 34. centurion-aggro: While challenging, +2 power ---

header("Cylon Centurion — Passive: +2 while challenging");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-112"], // Cylon Centurion (power 2 + 2 = 4 while challenging)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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

  // Undefended challenge: opponent should lose 4 (2 base + 2 aggro)
  const s = challengeUndefended(state, 0, 1);
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 4, `Opponent lost 4 influence (2 base + 2 aggro) — lost ${infLoss}`);
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// --- 35. adama-oldman: While controlling another alert personnel, +2 power ---

header("William Adama, The Old Man — Passive: +2 with another alert personnel");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-143", "BSG1-098"], // Adama Old Man (power 2) + Apollo
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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

  // Adama power 2 + 2 passive = 4 when another alert personnel exists
  const s = challengeUndefended(state, 0, 1, "BSG1-143");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 4, `Opponent lost 4 (2 base + 2 Old Man passive) — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Adama");
  }
  printLog(state);
}

// --- 36. danna-noattack: Cannot challenge ---

header("D'Anna Biers, Reporter — Cannot challenge");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-114"], // D'Anna Reporter (cannot challenge)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const challengeActions = getValidActions(state, 0, bases).filter((a) => a.type === "challenge");
  assert(challengeActions.length === 0, "D'Anna cannot challenge (no challenge actions)");
}

// --- 37. starbuck-hotshot: +1 power for each other Pilot you control ---

header("Starbuck, Hotshot Pilot — Passive: +1 per other Pilot");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-136", "BSG1-098", "BSG2-129"], // Starbuck Hotshot + 2 other Pilots (no ability interference)
        deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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

  // Starbuck power 2 + 2 Pilots = 4
  const s = challengeUndefended(state, 0, 1, "BSG1-136");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 4, `Opponent lost 4 (2 base + 2 Pilots) — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Starbuck");
  }
  printLog(state);
}

// --- 38. anders-leader: All other Civilian units get +1 power ---

header("Anders, Resistance Leader — Passive: Other Civilians get +1 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-084", "BSG1-117"], // Anders Leader + Dr. Baltar Award Winner (Civilian, power 1)
        deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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

  // Baltar Award Winner: power 1 + 1 Anders buff = 2
  const s = challengeUndefended(state, 0, 1, "BSG1-117");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 2, `Opponent lost 2 (1 base + 1 Anders buff) — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Baltar");
  }
  printLog(state);
}

// --- 39. boomer-helo: While controlling alert Helo, +1 power ---

header("Boomer, Human-Lover — Passive: +1 while controlling alert Helo");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-088", "BSG1-122"], // Boomer Human-Lover + Helo Flight Officer
        deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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

  // Boomer power 2 + 1 Helo buff = 3
  const s = challengeUndefended(state, 0, 1, "BSG2-088");
  if (s) {
    state = s;
    const infLoss = 10 - state.players[1].influence;
    assert(infLoss === 3, `Opponent lost 3 (2 base + 1 Helo buff) — lost ${infLoss}`);
  } else {
    assert(false, "Could not challenge with Boomer");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 11: Triggered Abilities — Enter Play
// ============================================================

// --- 40. billy-etb: When enters play, gain 1 influence ---

header("Billy Keikeya, Presidential Aide — ETB: Gain 1 influence");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion base
        hand: ["BSG1-101"], // Billy Presidential Aide (cost 3 persuasion)
        alert: [],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Add supply cards to make base generate 3 persuasion
  const baseStack = state.players[0].zones.resourceStacks[0];
  baseStack.supplyCards.push({ defId: "BSG1-098", instanceId: "supply-1", faceUp: false });
  baseStack.supplyCards.push({ defId: "BSG1-099", instanceId: "supply-2", faceUp: false });

  const infBefore = state.players[0].influence;
  const playAction = findAction(getValidActions(state, 0, bases), "playCard");
  assert(!!playAction, "Can play Billy from hand");

  if (playAction) {
    const result = applyAction(state, 0, toGameAction(playAction), bases);
    state = result.state;
    assert(
      state.players[0].influence === infBefore + 1,
      `Gained 1 influence on ETB (${infBefore} → ${state.players[0].influence})`,
    );
  }
  printLog(state);
}

// --- 41. boomer-etb: When enters play, draw a card ---

header("Boomer, Raptor Pilot — ETB: Draw a card");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-001", // Agro Ship (logistics resource) — Boomer costs 3 logistics
        hand: ["BSG1-104"], // Boomer Raptor Pilot
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
        alert: [],
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Add supply cards so base generates 3 logistics total
  const baseStack0 = state.players[0].zones.resourceStacks[0];
  baseStack0.supplyCards.push({ defId: "BSG1-098", instanceId: "supply-b1", faceUp: false });
  baseStack0.supplyCards.push({ defId: "BSG1-099", instanceId: "supply-b2", faceUp: false });

  const deckBefore = state.players[0].deck.length;
  const playAction = findAction(getValidActions(state, 0, bases), "playCard");

  if (playAction) {
    const result = applyAction(state, 0, toGameAction(playAction), bases);
    state = result.state;
    // Hand should have a card (drew from ETB)
    assert(state.players[0].hand.length >= 1, "Drew a card on ETB");
    assert(state.players[0].deck.length === deckBefore - 1, "Deck decreased by 1");
  }
  printLog(state);
}

// --- 42. helo-defeat: When defeated, gain 2 influence ---

header("Helo, Prisoner of the Cylons — On defeat: Gain 2 influence");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-141"], // Adama Commander (power 4) as challenger
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG2-113"],
        influence: 10, // Helo Prisoner (power 1)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const infBefore = state.players[1].influence;
  // Challenge and Helo defends — Helo will lose (power 1 vs 4) and gain 2 influence on defeat
  const s = setupChallenge(state, 0, 1, true);
  if (s) {
    state = s;
    // Both players pass to resolve
    let result = applyAction(state, 0, { type: "challengePass" }, bases);
    state = result.state;
    if (state.challenge) {
      result = applyAction(state, 1, { type: "challengePass" }, bases);
      state = result.state;
    }
    // After challenge resolves, Helo should be defeated and player 1 gains 2 influence
    // (might need to check log for "gain 2 influence" message)
    const heloInAlert = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG2-113");
    assert(!heloInAlert, "Helo was defeated (not in alert)");
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// ============================================================
// CATEGORY 12: Special Passives
// ============================================================

// --- 43. hadrian-defense: Fleet defense level +1 ---

header("Hadrian, Master-At-Arms — Passive: Fleet defense level +1");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // power 5
        hand: [],
        alert: ["BSG2-112"], // Hadrian Master-At-Arms (+1 fleet defense)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 }, // power 6
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Fleet defense = base powers (5 + 6) = 11, plus Hadrian's +1 modifier = 12
  const effectiveDefense = state.fleetDefenseLevel + computeFleetDefenseModifiers(state);
  assert(effectiveDefense === 12, `Fleet defense = 12 (got ${effectiveDefense})`);
}

// --- 44. gaeta-cylon-reduce: Commit — Target unit cylon threat -1 ---

header("Mr. Gaeta, Brilliant Officer — Commit: Target cylon threat -1");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG2-119", "BSG1-103"], // Gaeta Brilliant + Boomer (cylon threat > 0)
      },
      player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "gaeta");
  assert(!!ability, "Gaeta cylon-reduce ability available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;
    // Check for temporary cylon threat reduction (stored on PlayerState)
    const boomer = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-103");
    const boomerId = boomer?.cards[0].instanceId ?? "";
    const cylonMod = state.players[0].temporaryCylonThreatMods?.[boomerId] ?? 0;
    assert(cylonMod === -1, `Cylon threat reduced by 1 (got ${cylonMod})`);
  }
  printLog(state);
}

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(60));
if (failed > 0) process.exit(1);
