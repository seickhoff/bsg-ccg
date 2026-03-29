/**
 * Headless test runner for BSG CCG base ability scenarios.
 * Run with: npx tsx server/src/test-scenario.ts
 */

import { loadCardRegistry } from "./cardLoader.js";
import { setCardRegistry, createDebugGame, applyAction, getValidActions } from "./game-engine.js";
import type { GameState, ValidAction, LogItem } from "@bsg/shared";

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

/** Convert a ValidAction (from getValidActions) into a GameAction (for applyAction).
 *  For makeChoice, pass the index in the actions array as choiceIndex. */
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

/** Initiate a challenge and have defender respond, advancing to step 2 (effects round).
 *  Returns the updated state or null if challenge setup failed. */
function setupChallenge(
  state: GameState,
  challengerPlayer: number,
  defenderPlayer: number,
): GameState | null {
  // Step 1: Challenger initiates
  const challengeAction = findAction(getValidActions(state, challengerPlayer, bases), "challenge");
  if (!challengeAction) {
    console.log("  (No challenge action available)");
    return null;
  }
  let result = applyAction(state, challengerPlayer, toGameAction(challengeAction), bases);
  let s = result.state;

  if (!s.challenge) {
    console.log("  (Challenge not created)");
    return null;
  }

  // Step 1b: Defender selects defender (or declines)
  if (s.challenge.waitingForDefender) {
    const defenderActions = getValidActions(s, defenderPlayer, bases);
    // Look for a defend action (with a unit) or declineTrigger, then defend
    const triggerAction = findAction(defenderActions, "playAbility");
    if (triggerAction) {
      // Agro Ship / Flattop trigger — use it first
      result = applyAction(s, defenderPlayer, toGameAction(triggerAction), bases);
      s = result.state;
    }

    // Now pick a defender
    const defendActions = getValidActions(s, defenderPlayer, bases);
    const defendAction = findAction(defendActions, "defend");
    const declineAction = findAction(defendActions, "declineTrigger");
    if (declineAction && !defendAction) {
      result = applyAction(s, defenderPlayer, toGameAction(declineAction), bases);
      s = result.state;
      // After declining trigger, should get defend options
      const postDecline = getValidActions(s, defenderPlayer, bases);
      const postDefend = findAction(postDecline, "defend");
      if (postDefend) {
        result = applyAction(s, defenderPlayer, toGameAction(postDefend), bases);
        s = result.state;
      }
    } else if (defendAction) {
      result = applyAction(s, defenderPlayer, toGameAction(defendAction), bases);
      s = result.state;
    }
  }

  // Should now be in step 2 (effects) or step 3 (mystic)
  if (!s.challenge) {
    console.log("  (Challenge resolved during defender selection)");
    return null;
  }

  return s;
}

// ============================================================
// Card IDs reference:
//   Personnel: BSG1-098 (Apollo Ace Pilot), BSG1-099 (Apollo CAG),
//              BSG1-100 (Apollo Political Liaison), BSG1-101 (Billy Presidential Aide),
//              BSG1-102 (Billy Press Secretary)
//   Cylon Personnel: BSG1-103 (Boomer, Cylon Pilot)
//   Ships: BSG1-144 (Colonial Viper)
// ============================================================

// --- 1. Colonial One: +1 influence ---

header("Colonial One — Exhaust: +1 influence");
{
  let state = createDebugGame(
    {
      player0: { baseId: "BSG1-004", hand: ["BSG1-098"], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-007", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const before = state.players[0].influence;
  const ability = findAbility(getValidActions(state, 0, bases), "colonial one");
  assert(!!ability, "Colonial One ability is available");

  const result = applyAction(state, 0, toGameAction(ability!), bases);
  state = result.state;

  assert(
    state.players[0].influence === before + 1,
    `Influence increased from ${before} to ${state.players[0].influence}`,
  );
  assert(state.players[0].zones.resourceStacks[0].exhausted, "Base is exhausted after use");
  printLog(state);
}

// --- 2. Galactica: opponent -1 influence ---

header("Galactica — Exhaust: opponent loses 1 influence");
{
  let state = createDebugGame(
    {
      player0: { baseId: "BSG1-007", hand: ["BSG1-098"], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const oppBefore = state.players[1].influence;
  const ability = findAbility(getValidActions(state, 0, bases), "galactica");
  assert(!!ability, "Galactica ability is available");

  // Target opponent (player-1) — Galactica allows targeting any player
  const ga = { ...toGameAction(ability!), targetInstanceId: "player-1" };
  const result = applyAction(state, 0, ga as GA, bases);
  state = result.state;

  assert(
    state.players[1].influence === oppBefore - 1,
    `Opponent influence decreased from ${oppBefore} to ${state.players[1].influence}`,
  );
  assert(state.players[0].zones.resourceStacks[0].exhausted, "Base is exhausted after use");
  printLog(state);
}

// --- 3. Celestra: look at top 2, choose which stays on top ---

header("Celestra — Exhaust: look at top 2, choose order");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-003",
        hand: ["BSG1-098"],
        alert: ["BSG1-100"],
        deck: ["BSG1-101", "BSG1-102", "BSG1-103", "BSG1-099"],
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "celestra");
  assert(!!ability, "Celestra ability is available");

  let result = applyAction(state, 0, toGameAction(ability!), bases);
  state = result.state;

  assert(!!state.pendingChoice, "Pending choice created");
  assert(state.pendingChoice?.type === "celestra", "Choice type is 'celestra'");
  assert(state.pendingChoice?.cards.length === 2, "2 cards revealed");
  assert(state.pendingChoice?.cards[0].defId === "BSG1-101", "First revealed: BSG1-101");
  assert(state.pendingChoice?.cards[1].defId === "BSG1-102", "Second revealed: BSG1-102");

  // Choose to keep the first card (index 0) on top
  const choiceActions = getValidActions(state, 0, bases);
  assert(choiceActions.length === 2, "2 choice actions available");

  result = applyAction(state, 0, toGameAction(choiceActions[0], 0), bases);
  state = result.state;

  assert(!state.pendingChoice, "Pending choice resolved");
  assert(state.players[0].deck[0].defId === "BSG1-101", "Chosen card is on top of deck");
  assert(
    state.players[0].deck[state.players[0].deck.length - 1].defId === "BSG1-102",
    "Other card is on bottom of deck",
  );
  printLog(state);
}

// --- 4. Cylon Base Star: ready target Cylon unit ---

header("Cylon Base Star — Exhaust: ready target Cylon unit");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005",
        hand: ["BSG1-098"],
        alert: ["BSG1-100"],
        reserve: ["BSG1-103"], // Cylon unit in reserve
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(state.players[0].zones.reserve.length === 1, "Cylon unit starts in reserve");
  assert(state.players[0].zones.alert.length === 1, "1 unit in alert initially");

  const ability = findAbility(getValidActions(state, 0, bases), "cylon base star");
  assert(!!ability, "Cylon Base Star ability is available");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;

    assert(state.players[0].zones.reserve.length === 0, "Reserve is now empty (unit was readied)");
    assert(state.players[0].zones.alert.length === 2, "Alert now has 2 units");
    const readied = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-103");
    assert(!!readied, "BSG1-103 (Cylon) is now in alert zone");
    printLog(state);
  }
}

// --- 5. Cylon Base Star: no valid targets (no Cylon units in reserve) ---

header("Cylon Base Star — No targets (non-Cylon in reserve)");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005",
        hand: ["BSG1-098"],
        alert: ["BSG1-100"],
        reserve: ["BSG1-098"], // Non-Cylon unit in reserve
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "cylon base star");
  assert(!ability, "Cylon Base Star ability NOT available (no Cylon targets)");
}

// --- 6. Ragnar Anchorage: extra action + resource override ---

header("Ragnar Anchorage — Exhaust: extra action (stays active player)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-006",
        hand: ["BSG1-098", "BSG1-099"],
        alert: ["BSG1-100"],
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(!state.players[0].ragnarResourceOverride, "No resource override flag initially");

  const ability = findAbility(getValidActions(state, 0, bases), "ragnar");
  assert(!!ability, "Ragnar Anchorage ability is available");

  const result = applyAction(state, 0, toGameAction(ability!), bases);
  state = result.state;

  // ragnarExtraAction is set then consumed by advanceExecutionTurn — the effect is
  // that activePlayerIndex stays on player 0 (extra action granted)
  assert(state.activePlayerIndex === 0, "Player 0 still active (extra action granted)");
  assert(state.players[0].ragnarResourceOverride === true, "Resource override flag set");
  assert(state.players[0].zones.resourceStacks[0].exhausted, "Base is exhausted");
  printLog(state);
}

// --- 7. Battlestar Galactica: +2 to challenger (during challenge step 2) ---

header("Battlestar Galactica — Exhaust: challenger gets +2 power");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-002", // Battlestar Galactica
        hand: [],
        alert: ["BSG1-098"], // challenger
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] }, // defender
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Set up challenge through to step 2
  const s = setupChallenge(state, 0, 1);
  if (s) {
    state = s;
    assert(!!state.challenge, "Challenge is active");
    assert(state.challenge!.step === 2, `Challenge at step 2 (got step ${state.challenge!.step})`);

    // Now look for the Battlestar Galactica ability
    const ability = findAbility(getValidActions(state, 0, bases), "battlestar galactica");
    assert(!!ability, "Battlestar Galactica ability available during challenge");

    if (ability) {
      const result = applyAction(state, 0, toGameAction(ability), bases);
      state = result.state;

      assert(
        state.challenge?.challengerPowerBuff === 2,
        `Challenger has +2 power buff (got ${state.challenge?.challengerPowerBuff})`,
      );
      assert(state.players[0].zones.resourceStacks[0].exhausted, "Base is exhausted");
    }
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// --- 8. Battlestar Galactica: NOT available outside challenge ---

header("Battlestar Galactica — Not available in execution (no challenge)");
{
  const state = createDebugGame(
    {
      player0: { baseId: "BSG1-002", hand: ["BSG1-098"], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "battlestar galactica");
  assert(!ability, "Battlestar Galactica ability NOT available outside challenge");
}

// --- 9. Delphi Union High School: +1 to unit in challenge ---

header("Delphi Union High School — Exhaust: +1 to unit in challenge");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-005", // Delphi Union High School
        hand: [],
        alert: ["BSG1-098"],
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = setupChallenge(state, 0, 1);
  if (s) {
    state = s;
    const ability = findAbility(getValidActions(state, 0, bases), "delphi");
    assert(!!ability, "Delphi Union ability available during challenge");

    if (ability) {
      const result = applyAction(state, 0, toGameAction(ability), bases);
      state = result.state;
      assert(
        state.challenge?.challengerPowerBuff === 1,
        `Challenger has +1 power buff (got ${state.challenge?.challengerPowerBuff})`,
      );
    }
  } else {
    assert(false, "Failed to set up challenge");
  }
  printLog(state);
}

// --- 10. Assault Base Star: +2 to Cylon unit in challenge ---

header("Assault Base Star — Exhaust: Cylon unit gets +2 in challenge");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-001", // Assault Base Star
        hand: [],
        alert: ["BSG1-103"], // Cylon unit as challenger
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = setupChallenge(state, 0, 1);
  if (s) {
    state = s;
    const ability = findAbility(getValidActions(state, 0, bases), "assault base star");
    assert(!!ability, "Assault Base Star ability available for Cylon challenger");

    if (ability) {
      const result = applyAction(state, 0, toGameAction(ability), bases);
      state = result.state;
      assert(
        state.challenge?.challengerPowerBuff === 2,
        `Cylon challenger has +2 power buff (got ${state.challenge?.challengerPowerBuff})`,
      );
    }
  } else {
    assert(false, "Failed to set up challenge for Cylon unit");
  }
  printLog(state);
}

// --- 11. Assault Base Star: NOT available for non-Cylon ---

header("Assault Base Star — Not available for non-Cylon challenger");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-001",
        hand: [],
        alert: ["BSG1-098"], // Non-Cylon challenger
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = setupChallenge(state, 0, 1);
  if (s) {
    state = s;
    const ability = findAbility(getValidActions(state, 0, bases), "assault base star");
    assert(!ability, "Assault Base Star NOT available for non-Cylon challenger");
  } else {
    assert(false, "Failed to set up challenge");
  }
}

// --- 11b. Assault Base Star: usable in execution phase on Cylon unit ---

header("Assault Base Star — Execution phase: Cylon unit gets +2 power buff");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-001", // Assault Base Star
        hand: [],
        alert: ["BSG1-103"], // Cylon unit in alert
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Should be available during execution phase (no challenge active)
  assert(!state.challenge, "No challenge active");
  const ability = findAbility(getValidActions(state, 0, bases), "assault base star");
  assert(!!ability, "Assault Base Star available in execution phase for Cylon unit");

  if (ability) {
    const result = applyAction(state, 0, toGameAction(ability), bases);
    state = result.state;

    // Power buff should be on the unit stack, not on challenge state
    const cylonStack = state.players[0].zones.alert.find((s) => s.cards[0].defId === "BSG1-103");
    assert(
      cylonStack?.powerBuff === 2,
      `Cylon unit has +2 power buff on stack (got ${cylonStack?.powerBuff})`,
    );
    assert(state.players[0].zones.resourceStacks[0].exhausted, "Base is exhausted");
  }
  printLog(state);
}

// --- 11c. Assault Base Star: NOT available in execution for non-Cylon ---

header("Assault Base Star — Execution phase: not available for non-Cylon");
{
  const state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-001",
        hand: [],
        alert: ["BSG1-098"], // Non-Cylon unit
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "assault base star");
  assert(!ability, "Assault Base Star NOT available in execution for non-Cylon unit");
}

// --- 12. Agro Ship: triggered on challenged, readies personnel ---

header("Agro Ship — Trigger: on challenged, ready personnel from reserve");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // challenger
      },
      player1: {
        baseId: "BSG1-001", // Agro Ship
        alert: ["BSG1-100"], // defender
        reserve: ["BSG1-101"], // personnel to be readied
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(state.players[1].zones.reserve.length === 1, "Defender has 1 unit in reserve");

  // Player 0 challenges
  const challengeAction = findAction(getValidActions(state, 0, bases), "challenge");
  assert(!!challengeAction, "Challenge action available");

  let result = applyAction(state, 0, toGameAction(challengeAction!), bases);
  state = result.state;

  assert(!!state.challenge, "Challenge is active");

  // The Agro Ship trigger uses "useTriggeredAbility" action type
  const defenderActions = getValidActions(state, 1, bases);
  const agroTrigger = findAction(defenderActions, "useTriggeredAbility", "agro ship");
  assert(!!agroTrigger, "Agro Ship trigger available to defender");

  if (agroTrigger) {
    result = applyAction(state, 1, toGameAction(agroTrigger), bases);
    state = result.state;
    assert(state.players[1].zones.reserve.length === 0, "Personnel moved out of reserve");
    const readied = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-101");
    assert(!!readied, "BSG1-101 personnel is now in alert");
    assert(state.players[1].zones.resourceStacks[0].exhausted, "Agro Ship base is exhausted");
  }
  printLog(state);
}

// --- 13. Flattop: triggered on challenged, readies ship ---

header("Flattop — Trigger: on challenged, ready ship from reserve");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"], // challenger
      },
      player1: {
        baseId: "BSG1-006", // Flattop
        alert: ["BSG1-100"], // defender
        reserve: ["BSG1-144"], // ship to be readied
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  assert(state.players[1].zones.reserve.length === 1, "Defender has 1 ship in reserve");

  const challengeAction = findAction(getValidActions(state, 0, bases), "challenge");
  let result = applyAction(state, 0, toGameAction(challengeAction!), bases);
  state = result.state;

  const defenderActions = getValidActions(state, 1, bases);
  const flatTrigger = findAction(defenderActions, "useTriggeredAbility", "flattop");
  assert(!!flatTrigger, "Flattop trigger available to defender");

  if (flatTrigger) {
    result = applyAction(state, 1, toGameAction(flatTrigger), bases);
    state = result.state;
    assert(state.players[1].zones.reserve.length === 0, "Ship moved out of reserve");
    const readied = state.players[1].zones.alert.find((s) => s.cards[0].defId === "BSG1-144");
    assert(!!readied, "BSG1-144 ship is now in alert");
    assert(state.players[1].zones.resourceStacks[0].exhausted, "Flattop base is exhausted");
  }
  printLog(state);
}

// --- 14. I.H.T. Colonial One: reduce influence loss by 2 (passive trigger) ---

header("I.H.T. Colonial One — Trigger: reduce influence loss by 2");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // Galactica: opponent -1 influence
        hand: [],
        alert: ["BSG1-100"],
      },
      player1: {
        baseId: "BSG1-008", // I.H.T. Colonial One
        alert: ["BSG1-100"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const oppBefore = state.players[1].influence;

  const ability = findAbility(getValidActions(state, 0, bases), "galactica");
  assert(!!ability, "Galactica ability available");

  const ga = { ...toGameAction(ability!), targetInstanceId: "player-1" };
  const result = applyAction(state, 0, ga as GA, bases);
  state = result.state;

  // I.H.T. reduces loss by 2, so 1 - 2 = 0 net loss
  assert(
    state.players[1].influence === oppBefore,
    `Opponent influence unchanged: ${oppBefore} → ${state.players[1].influence} (loss intercepted)`,
  );
  assert(
    state.players[1].zones.resourceStacks[0].exhausted,
    "I.H.T. Colonial One is exhausted after intercepting",
  );
  printLog(state);
}

// --- 15. I.H.T. Colonial One: already exhausted, no reduction ---

header("I.H.T. Colonial One — Already exhausted, no reduction");
{
  let state = createDebugGame(
    {
      player0: { baseId: "BSG1-007", hand: [], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-008", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Manually exhaust I.H.T.
  state.players[1].zones.resourceStacks[0].exhausted = true;
  const oppBefore = state.players[1].influence;

  const ability = findAbility(getValidActions(state, 0, bases), "galactica");
  const ga = { ...toGameAction(ability!), targetInstanceId: "player-1" };
  const result = applyAction(state, 0, ga as GA, bases);
  state = result.state;

  assert(
    state.players[1].influence === oppBefore - 1,
    `Opponent lost 1 influence (I.H.T. exhausted): ${oppBefore} → ${state.players[1].influence}`,
  );
  printLog(state);
}

// --- 16. BS-75 Galactica: NOT available in normal challenge ---

header("BS-75 Galactica — Not available in normal challenge (non-Cylon threat)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG2-003", // BS-75 Galactica
        hand: [],
        alert: ["BSG1-098"],
      },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const s = setupChallenge(state, 0, 1);
  if (s) {
    state = s;
    const ability = findAbility(getValidActions(state, 0, bases), "bs-75");
    assert(!ability, "BS-75 Galactica NOT available in normal (non-Cylon threat) challenge");
  } else {
    assert(false, "Failed to set up challenge");
  }
}

// --- 17. Base exhaustion prevents reuse ---

header("Base exhaustion prevents reuse (Colonial One double-use)");
{
  let state = createDebugGame(
    {
      player0: { baseId: "BSG1-004", hand: ["BSG1-098", "BSG1-099"], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-007", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability1 = findAbility(getValidActions(state, 0, bases), "colonial one");
  assert(!!ability1, "Colonial One available first time");

  const result = applyAction(state, 0, toGameAction(ability1!), bases);
  state = result.state;

  assert(state.players[0].zones.resourceStacks[0].exhausted, "Base exhausted after first use");

  const ability2 = findAbility(getValidActions(state, 0, bases), "colonial one");
  assert(!ability2, "Colonial One NOT available when exhausted");
}

// --- 18. Colonial Heavy 798: passive only (no voluntary action) ---

header("Colonial Heavy 798 — passive: no voluntary action");
{
  const state = createDebugGame(
    {
      player0: { baseId: "BSG2-004", hand: [], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "colonial heavy");
  assert(!ability, "Colonial Heavy 798 has no voluntary action (passive/triggered only)");
  assert(!state.players[0].zones.resourceStacks[0].exhausted, "Base is ready (not exhausted)");
}

// --- 19. Blockading Base Star: passive only (no voluntary action) ---

header("Blockading Base Star — passive: no voluntary action");
{
  const state = createDebugGame(
    {
      player0: { baseId: "BSG2-002", hand: [], alert: ["BSG1-100"] },
      player1: { baseId: "BSG1-004", alert: ["BSG1-100"] },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const ability = findAbility(getValidActions(state, 0, bases), "blockading");
  assert(!ability, "Blockading Base Star has no voluntary action (passive/triggered only)");
}

// --- 20. Agro Ship: no trigger when no personnel in reserve ---

header("Agro Ship — No trigger (no personnel in reserve)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"],
      },
      player1: {
        baseId: "BSG1-001", // Agro Ship
        alert: ["BSG1-100"],
        reserve: ["BSG1-144"], // a SHIP, not personnel — should not trigger
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const challengeAction = findAction(getValidActions(state, 0, bases), "challenge");
  const result = applyAction(state, 0, toGameAction(challengeAction!), bases);
  state = result.state;

  const defenderActions = getValidActions(state, 1, bases);
  const agroTrigger = findAction(defenderActions, "useTriggeredAbility", "agro ship");
  assert(!agroTrigger, "Agro Ship trigger NOT available (no personnel in reserve, only ship)");
}

// --- 21. Flattop: no trigger when no ships in reserve ---

header("Flattop — No trigger (no ships in reserve)");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: ["BSG1-098"],
      },
      player1: {
        baseId: "BSG1-006", // Flattop
        alert: ["BSG1-100"],
        reserve: ["BSG1-101"], // a PERSONNEL, not ship — should not trigger
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const challengeAction = findAction(getValidActions(state, 0, bases), "challenge");
  const result = applyAction(state, 0, toGameAction(challengeAction!), bases);
  state = result.state;

  const defenderActions = getValidActions(state, 1, bases);
  const flatTrigger = findAction(defenderActions, "useTriggeredAbility", "flattop");
  assert(!flatTrigger, "Flattop trigger NOT available (no ships in reserve, only personnel)");
}

// --- Cylon challenge: abilities during effects round ---

header("Cylon challenge — unit and base abilities available during effects round");
{
  // Setup: Apollo (BSG1-098) as challenger, Crashdown (BSG1-110) with commit buff ability.
  // Need lots of alert units to push cylon threat level above fleet defense.
  // BSG1-103 (Boomer Cylon Pilot) has cylonThreat 4, others ~2.
  // Fleet defense = base0.power + base1.power = 6 + 6 = 12.
  // Need threat > 12.  Each unit: ~2-4 threat. 7 units needed.
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // Galactica (power 6)
        alert: ["BSG1-098", "BSG1-110", "BSG1-103", "BSG1-099", "BSG1-101"],
        hand: [],
        deck: ["BSG1-102", "BSG1-117", "BSG1-118", "BSG1-119"],
      },
      player1: {
        baseId: "BSG1-007", // Galactica (power 6)
        alert: ["BSG1-100", "BSG1-103", "BSG1-099", "BSG1-106", "BSG2-101"],
        // BSG1-106 = Centurion Ambusher (commit: target Cylon threat +2 power)
        // BSG2-101 = Dr. Cottle, Bearer of Bad News (commit: target personnel -2 power)
        deck: ["BSG1-101", "BSG1-102", "BSG1-117", "BSG1-118"],
      },
      phase: "cylon",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  console.log(`  Cylon threats: ${state.cylonThreats.length}`);
  console.log(`  Phase: ${state.phase}`);

  if (state.cylonThreats.length > 0) {
    const cylonActions = getValidActions(state, 0, bases);
    const challengeAction = findAction(cylonActions, "challengeCylon");
    assert(!!challengeAction, "challengeCylon action available");

    if (challengeAction) {
      // Challenge with Apollo (first alert unit)
      const apolloId = state.players[0].zones.alert[0].cards[0].instanceId;
      const result = applyAction(
        state,
        0,
        { type: "challengeCylon", challengerInstanceId: apolloId, threatIndex: 0 },
        bases,
      );
      state = result.state;

      assert(!!state.challenge, "Challenge created");
      assert(state.challenge!.step === 2, "Challenge at step 2 (effects round)");
      assert(state.challenge!.isCylonChallenge === true, "Challenge is Cylon challenge");
      assert(state.activePlayerIndex === 0, "Challenger is active player");

      // Check valid actions for player 0 during step 2
      const effectsActions = getValidActions(state, 0, bases);
      console.log(
        `  Effects round actions: ${effectsActions.map((a) => `${a.type}(${a.description})`).join(", ")}`,
      );

      const crashdownAbility = findAbility(effectsActions, "crashdown");
      assert(!!crashdownAbility, "Crashdown unit ability available during Cylon challenge");

      const baseAbility = findAbility(effectsActions, "galactica");
      assert(!!baseAbility, "Galactica base ability available during Cylon challenge");

      const passAction = findAction(effectsActions, "challengePass");
      assert(!!passAction, "challengePass available");

      const abilityActions = effectsActions.filter((a) => a.type === "playAbility");
      console.log(`  Total ability actions: ${abilityActions.length}`);

      // Test using the Galactica base ability to hurt opponent
      if (baseAbility) {
        const r2 = applyAction(state, 0, toGameAction(baseAbility), bases);
        state = r2.state;
        assert(
          state.players[0].zones.resourceStacks[0].exhausted,
          "Galactica base exhausted after use in Cylon challenge",
        );
      }

      // After P0 uses base ability, advanceChallengeEffectTurn moves to P1
      assert(state.activePlayerIndex === 1, "After P0 uses ability, P1 (Cylon player) is active");
      assert(!!state.challenge, "Challenge still active");

      // Check P1's available abilities during the effects round
      const p1Actions = getValidActions(state, 1, bases);
      console.log(
        `  P1 effects round actions: ${p1Actions.map((a) => `${a.type}(${a.description})`).join(", ")}`,
      );

      // P1 should have Centurion Ambusher ability (buff the Cylon threat)
      const centurionAbility = findAbility(p1Actions, "centurion");
      assert(!!centurionAbility, "Centurion Ambusher ability available for Cylon player");

      // P1 should have Dr. Cottle ability (debuff the challenger)
      const cottleAbility = findAbility(p1Actions, "cottle");
      assert(!!cottleAbility, "Dr. Cottle debuff ability available for Cylon player");

      // Record threat power before opponent abilities
      const threatPowerBefore = state.cylonThreats[0]?.power ?? 0;
      const challengerBuffBefore = (state.challenge as any)?.challengerPowerBuff ?? 0;

      // P1 uses Centurion Ambusher: target Cylon threat gets +2 power
      if (centurionAbility) {
        const r3 = applyAction(state, 1, toGameAction(centurionAbility), bases);
        state = r3.state;
        assert(
          state.cylonThreats[0]?.power === threatPowerBefore + 2,
          `Cylon threat power increased by 2 (${threatPowerBefore} → ${state.cylonThreats[0]?.power})`,
        );
        console.log(
          `  Centurion Ambusher: threat power ${threatPowerBefore} → ${state.cylonThreats[0]?.power}`,
        );
      }

      // After centurion-ambush, turn advances to P0. P0 passes to give P1 another turn.
      assert(state.activePlayerIndex === 0, "Turn returned to P0 after P1 ability");
      const p0Pass = applyAction(state, 0, { type: "challengePass" }, bases);
      state = p0Pass.state;
      assert(state.activePlayerIndex === 1, "P1 active again after P0 pass");

      // P1 uses Dr. Cottle: target challenger (Apollo) gets -2 power
      if (cottleAbility) {
        // Re-fetch P1 actions since state changed
        const p1Actions2 = getValidActions(state, 1, bases);
        const cottleAbility2 = findAbility(p1Actions2, "cottle");
        assert(!!cottleAbility2, "Dr. Cottle still available after P0 pass");

        const r4 = applyAction(state, 1, toGameAction(cottleAbility2!), bases);
        state = r4.state;
        const challengerBuffAfter = (state.challenge as any)?.challengerPowerBuff ?? 0;
        assert(
          challengerBuffAfter === challengerBuffBefore - 2,
          `Challenger power debuffed by 2 (${challengerBuffBefore} → ${challengerBuffAfter})`,
        );
        console.log(
          `  Dr. Cottle: challenger buff ${challengerBuffBefore} → ${challengerBuffAfter}`,
        );
      }

      // After cottle, turn advances to P0. Both pass to resolve.
      assert(state.activePlayerIndex === 0, "Turn returned to P0 after Cottle");
      const p0Pass2 = applyAction(state, 0, { type: "challengePass" }, bases);
      state = p0Pass2.state;
      // P1's turn — P1 passes too
      if (state.challenge) {
        const p1Pass = applyAction(state, 1, { type: "challengePass" }, bases);
        state = p1Pass.state;
      }
      // Challenge should be resolved now (both passed consecutively)
      assert(!state.challenge, "Challenge resolved after both players pass");
      console.log(`  Challenge resolved. P0 influence: ${state.players[0].influence}`);
    }
  } else {
    console.log("  SKIP: No cylon threats — threat level too low");
  }
  printLog(state);
}

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(60));

if (failed > 0) {
  process.exit(1);
}
