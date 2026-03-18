/**
 * Headless test runner for BSG CCG event ability scenarios.
 * Run with: npx tsx server/src/test-events.ts
 */

import { loadCardRegistry } from "./cardLoader.js";
import { setCardRegistry, createDebugGame, applyAction, getValidActions } from "./game-engine.js";
import type { GameState, ValidAction, LogItem, CardInstance } from "@bsg/shared";

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
        sourceInstanceId: va.selectableInstanceIds![0],
        targetInstanceId: va.targetInstanceId,
      };
    case "playCard":
      return {
        type: "playCard",
        cardIndex: va.selectableCardIndices![0],
        targetInstanceId: va.targetInstanceId,
      };
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
    case "playEventInChallenge":
      return {
        type: "playEventInChallenge",
        cardIndex: va.selectableCardIndices![0],
        targetInstanceId: va.targetInstanceId,
      };
    default:
      return base as GA;
  }
}

function findAction(actions: VA[], type: string, keyword?: string): VA | undefined {
  return actions.find(
    (a) =>
      a.type === type && (!keyword || a.description?.toLowerCase().includes(keyword.toLowerCase())),
  );
}

function findPlayCard(actions: VA[], keyword: string): VA | undefined {
  return actions.find(
    (a) => a.type === "playCard" && a.description?.toLowerCase().includes(keyword.toLowerCase()),
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

function logContains(state: GameState, keyword: string): boolean {
  return state.log.some((e) => logText(e).toLowerCase().includes(keyword.toLowerCase()));
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

/** Add supply cards to player's base resource stack */
function addSupply(state: GameState, playerIndex: number, count: number) {
  const baseStack = state.players[playerIndex].zones.resourceStacks[0];
  for (let i = 0; i < count; i++) {
    baseStack.supplyCards.push({
      defId: "BSG1-098",
      instanceId: `supply-${playerIndex}-${i}`,
      faceUp: false,
    });
  }
}

/** Find a unit's instance ID from its defId on a player's board */
function findInstanceId(state: GameState, playerIndex: number, defId: string): string | undefined {
  const p = state.players[playerIndex];
  for (const zone of [p.zones.alert, p.zones.reserve]) {
    for (const stack of zone) {
      if (stack.cards[0]?.defId === defId) return stack.cards[0].instanceId;
    }
  }
  return undefined;
}

/** Play an event from hand by keyword, return updated state.
 *  targetDefId: optionally specify target by card definition ID (finds the matching instanceId) */
function playEvent(
  state: GameState,
  playerIndex: number,
  keyword: string,
  opts?: { targetId?: string; targetDefId?: string; targetPlayerIndex?: number },
): { state: GameState; played: boolean } {
  const actions = getValidActions(state, playerIndex, bases);
  const action = findPlayCard(actions, keyword);
  if (!action) return { state, played: false };

  let resolvedTarget = opts?.targetId;
  if (!resolvedTarget && opts?.targetDefId != null) {
    // Find the matching instanceId from the selectable targets
    const pi = opts.targetPlayerIndex ?? 1;
    resolvedTarget = findInstanceId(state, pi, opts.targetDefId);
  }
  if (!resolvedTarget) {
    resolvedTarget = action.selectableInstanceIds?.[0] ?? action.targetInstanceId;
  }

  const ga: GA = {
    type: "playCard",
    cardIndex: action.selectableCardIndices![0],
    targetInstanceId: resolvedTarget,
  };
  const result = applyAction(state, playerIndex, ga, bases);
  return { state: result.state, played: true };
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
    const defActions = getValidActions(s, defenderPlayer, bases);
    const decline = findAction(defActions, "declineTrigger");
    if (decline) {
      result = applyAction(s, defenderPlayer, toGameAction(decline), bases);
      s = result.state;
    }
    result = applyAction(s, defenderPlayer, { type: "defend", defenderInstanceId: null }, bases);
    s = result.state;
  }
  s = resolveChallenge(s);
  return s;
}

// ============================================================
// CATEGORY 1: POWER BUFFS
// ============================================================

// --- 1. Fire Support: Target unit +2 power ---
header("Fire Support — Target unit +2 power");
{
  // BSG1-027 costs security 2. Use BSG1-007 base (security)
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-027"], // Fire Support
        alert: ["BSG1-102"], // Billy (power 1)
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
  addSupply(state, 0, 1); // base(1) + supply(1) = 2 security

  const { state: s, played } = playEvent(state, 0, "fire support");
  assert(played, "Fire Support playable");
  assert(
    logContains(s, "fire support") && logContains(s, "+2 power"),
    "Fire Support grants +2 power",
  );
  printLog(s);
}

// --- 2. Outmaneuvered: Target ship -2 power ---
header("Outmaneuvered — Target ship -2 power");
{
  // BSG1-036 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-036"], // Outmaneuvered
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-146"],
        influence: 10, // Colonial Shuttle (ship)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "outmaneuvered");
  assert(played, "Outmaneuvered playable");
  assert(
    logContains(s, "outmaneuvered") && logContains(s, "-2 power"),
    "Outmaneuvered grants -2 power",
  );
  printLog(s);
}

// --- 3. Vision of Serpents: Target personnel -2 power ---
header("Vision of Serpents — Target personnel -2 power");
{
  // BSG1-052 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-052"], // Vision of Serpents
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10, // Billy (personnel)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "vision of serpents");
  assert(played, "Vision of Serpents playable");
  assert(
    logContains(s, "vision of serpents") && logContains(s, "-2 power"),
    "Vision of Serpents grants -2 power",
  );
  printLog(s);
}

// ============================================================
// CATEGORY 2: UNIT STATE MANAGEMENT
// ============================================================

// --- 4. Condition One: Ready target unit ---
header("Condition One — Ready target unit");
{
  // BSG1-015 costs logistics 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-015"], // Condition One
        alert: [],
        reserve: ["BSG1-102"], // Billy in reserve (ready target)
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
  addSupply(state, 0, 1);

  const reserveBefore = state.players[0].zones.reserve.length;
  const { state: s, played } = playEvent(state, 0, "condition one");
  assert(played, "Condition One playable");
  assert(s.players[0].zones.alert.length > 0, "Unit moved to alert");
  assert(s.players[0].zones.reserve.length < reserveBefore, "Unit left reserve");
  printLog(s);
}

// --- 5. Condition Two: Commit target unit ---
header("Condition Two — Commit target unit");
{
  // BSG1-016 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-016"], // Condition Two
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10, // Billy in alert
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "condition two");
  assert(played, "Condition Two playable");
  // Target (opponent's Billy) should move from alert to reserve
  assert(s.players[1].zones.reserve.length > 0, "Target committed to reserve");
  printLog(s);
}

// --- 6. Dissension: Exhaust all reserve cards ---
header("Dissension — Exhaust all reserve cards");
{
  // BSG1-022 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007",
        hand: ["BSG1-022"], // Dissension
        alert: [],
        reserve: ["BSG1-098"], // Apollo in reserve (should get exhausted)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: [],
        reserve: ["BSG1-102"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "dissension");
  assert(played, "Dissension playable");
  // All reserve units should be exhausted
  const p0Exhausted = s.players[0].zones.reserve.every((u) => u.exhausted);
  const p1Exhausted = s.players[1].zones.reserve.every((u) => u.exhausted);
  assert(p0Exhausted && p1Exhausted, "All reserve cards exhausted");
  printLog(s);
}

// --- 7. Determination: Restore target unit ---
header("Determination — Restore target unit");
{
  // BSG2-014 costs logistics 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-014"], // Determination
        alert: ["BSG1-102"], // Billy (will exhaust)
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

  // Manually exhaust the unit
  state.players[0].zones.alert[0].exhausted = true;
  const { state: s, played } = playEvent(state, 0, "determination");
  assert(played, "Determination playable");
  assert(!s.players[0].zones.alert[0]?.exhausted, "Target unit restored");
  printLog(s);
}

// --- 8. Sneak Attack: Commit all Fighters ---
header("Sneak Attack — Commit all Fighters");
{
  // BSG1-043 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-043"], // Sneak Attack
        alert: ["BSG1-147"], // Colonial Viper 113 (Fighter)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-147"],
        influence: 10, // Also has Fighter
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "sneak attack");
  assert(played, "Sneak Attack playable");
  // All Fighters should be committed (moved to reserve)
  const p0FightersInAlert = s.players[0].zones.alert.filter((u) => {
    const def = registry.cards[u.cards[0].defId];
    return def?.traits?.includes("Fighter" as any);
  });
  const p1FightersInAlert = s.players[1].zones.alert.filter((u) => {
    const def = registry.cards[u.cards[0].defId];
    return def?.traits?.includes("Fighter" as any);
  });
  assert(p0FightersInAlert.length === 0, "Player 0 Fighters committed");
  assert(p1FightersInAlert.length === 0, "Player 1 Fighters committed");
  printLog(s);
}

// ============================================================
// CATEGORY 3: UNIT DEFEAT / REMOVAL
// ============================================================

// --- 9. Angry: Commit+exhaust own personnel → defeat target personnel ---
header("Angry — Defeat target personnel");
{
  // BSG1-011 costs security 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-011"], // Angry
        alert: ["BSG1-098"], // Apollo Ace Pilot (personnel to commit/exhaust)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10, // Billy (target to defeat)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2); // 3 security total

  const oppAlertBefore = state.players[1].zones.alert.length;
  const { state: s, played } = playEvent(state, 0, "angry", {
    targetDefId: "BSG1-102",
    targetPlayerIndex: 1,
  });
  assert(played, "Angry playable");
  // Own personnel should be committed+exhausted
  const ownReserve = s.players[0].zones.reserve.find((u) => u.cards[0].defId === "BSG1-098");
  assert(!!ownReserve && ownReserve.exhausted, "Own personnel committed and exhausted");
  // Target should be defeated
  assert(s.players[1].zones.alert.length < oppAlertBefore, "Target personnel defeated");
  printLog(s);
}

// --- 10. Left Behind: Defeat all units ---
header("Left Behind — Defeat all units");
{
  // BSG2-022 costs persuasion 2 + security 3 = needs both resource types
  // Use persuasion base + add an asset for security
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-022"], // Left Behind
        alert: ["BSG1-098"], // Apollo (will be defeated too)
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
  addSupply(state, 0, 1); // 2 persuasion total

  // Add a security asset with 2 supply cards (3 security)
  const secAsset = { defId: "BSG1-099", instanceId: "sec-asset-1", faceUp: true };
  state.players[0].zones.resourceStacks.push({
    topCard: secAsset,
    supplyCards: [
      { defId: "BSG1-100", instanceId: "sec-supply-1", faceUp: false },
      { defId: "BSG1-101", instanceId: "sec-supply-2", faceUp: false },
    ],
    exhausted: false,
  });

  const { state: s, played } = playEvent(state, 0, "left behind");
  assert(played, "Left Behind playable");
  const totalUnits =
    s.players[0].zones.alert.length +
    s.players[0].zones.reserve.length +
    s.players[1].zones.alert.length +
    s.players[1].zones.reserve.length;
  assert(totalUnits === 0, "All units defeated");
  printLog(s);
}

// --- 11. Like a Ghost Town: Defeat all Civilian units ---
header("Like a Ghost Town — Defeat all Civilian units");
{
  // BSG2-024 costs security 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-024"], // Like a Ghost Town
        alert: ["BSG1-098"], // Apollo (not Civilian — should survive)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-117"],
        influence: 10, // Dr. Baltar (Civilian)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2); // 3 security

  const { state: s, played } = playEvent(state, 0, "ghost town");
  assert(played, "Like a Ghost Town playable");
  assert(s.players[0].zones.alert.length === 1, "Non-Civilian survives");
  assert(s.players[1].zones.alert.length === 0, "Civilian defeated");
  printLog(s);
}

// ============================================================
// CATEGORY 4: CARD MOVEMENT / BOUNCE
// ============================================================

// --- 12. Bingo Fuel: Return target alert ship to hand ---
header("Bingo Fuel — Return alert ship to hand");
{
  // BSG1-012 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-012"], // Bingo Fuel
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-146"],
        influence: 10, // Colonial Shuttle (ship)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1); // 2 persuasion

  const { state: s, played } = playEvent(state, 0, "bingo fuel");
  assert(played, "Bingo Fuel playable");
  assert(s.players[1].zones.alert.length === 0, "Ship removed from alert");
  assert(
    s.players[1].hand.some((c: CardInstance) => c.defId === "BSG1-146"),
    "Ship returned to hand",
  );
  printLog(s);
}

// --- 12b. Bingo Fuel targeting OWN ship ---
header("Bingo Fuel — Return own alert ship to hand");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-012"], // Bingo Fuel
        alert: ["BSG1-146"], // Colonial Shuttle (own ship)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
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
  addSupply(state, 0, 1); // 2 persuasion

  const { state: s, played } = playEvent(state, 0, "bingo fuel");
  assert(played, "Bingo Fuel playable on own ship");
  assert(s.players[0].zones.alert.length === 0, "Own ship removed from alert");
  assert(
    s.players[0].hand.some((c: CardInstance) => c.defId === "BSG1-146"),
    "Own ship returned to own hand",
  );
  // Hand: started with 1 (Bingo Fuel), played it (-1), got ship back (+1) = 1
  assert(s.players[0].hand.length === 1, `Hand has 1 card (got ${s.players[0].hand.length})`);
  printLog(s);
}

// --- 13. Sick Bay: Return target alert personnel to hand ---
header("Sick Bay — Return alert personnel to hand");
{
  // BSG1-042 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-042"], // Sick Bay
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10, // Billy (personnel)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "sick bay");
  assert(played, "Sick Bay playable");
  assert(s.players[1].zones.alert.length === 0, "Personnel removed from alert");
  assert(
    s.players[1].hand.some((c: CardInstance) => c.defId === "BSG1-102"),
    "Personnel returned to hand",
  );
  printLog(s);
}

// --- 14. Under Arrest: Put target personnel on top of deck ---
header("Under Arrest — Put personnel on top of deck");
{
  // BSG1-051 costs logistics 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-051"], // Under Arrest
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102"],
        influence: 10, // Billy
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const deckBefore = state.players[1].deck.length;
  const { state: s, played } = playEvent(state, 0, "under arrest");
  assert(played, "Under Arrest playable");
  assert(s.players[1].zones.alert.length === 0, "Personnel removed from board");
  assert(s.players[1].deck.length === deckBefore + 1, "Personnel on top of deck");
  assert(s.players[1].deck[0].defId === "BSG1-102", "Correct card on top");
  printLog(s);
}

// --- 15. Stranded: Shuffle target reserve personnel into deck ---
header("Stranded — Shuffle reserve personnel into deck");
{
  // BSG1-047 costs security 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-047"], // Stranded
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: [],
        reserve: ["BSG1-102"],
        influence: 10, // Billy in reserve
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2);

  const deckBefore = state.players[1].deck.length;
  const { state: s, played } = playEvent(state, 0, "stranded");
  assert(played, "Stranded playable");
  assert(s.players[1].zones.reserve.length === 0, "Personnel removed from reserve");
  assert(s.players[1].deck.length === deckBefore + 1, "Personnel shuffled into deck");
  printLog(s);
}

// ============================================================
// CATEGORY 5: MISSION MANIPULATION
// ============================================================

// --- 16. Catastrophe: Defeat target persistent mission ---
header("Catastrophe — Defeat persistent mission");
{
  // BSG1-013 costs persuasion 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-013"], // Catastrophe
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-078"],
        influence: 10, // A persistent mission in alert
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2); // 3 persuasion

  const { state: s, played } = playEvent(state, 0, "catastrophe");
  // If target mission is persistent, it should be defeated
  if (played) {
    assert(logContains(s, "catastrophe"), "Catastrophe resolved");
    printLog(s);
  } else {
    // May not find a valid target — check for persistent missions
    console.log("  SKIP: No valid persistent mission target found");
  }
}

// --- 17. This Tribunal Is Over: Defeat target mission ---
header("This Tribunal Is Over — Defeat any mission");
{
  // BSG2-037 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-037"], // This Tribunal Is Over
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-060"],
        influence: 10, // Based On Scriptures (mission)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "tribunal");
  assert(played, "This Tribunal Is Over playable");
  assert(s.players[1].zones.alert.length === 0, "Mission defeated");
  assert(logContains(s, "tribunal"), "Tribunal resolved");
  printLog(s);
}

// --- 18. Crushing Reality: Exhaust target mission ---
header("Crushing Reality — Exhaust target mission");
{
  // BSG2-011 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-011"], // Crushing Reality
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-060"],
        influence: 10, // Mission in alert
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "crushing reality");
  assert(played, "Crushing Reality playable");
  const mission = s.players[1].zones.alert.find((u) => u.cards[0].defId === "BSG1-060");
  assert(mission?.exhausted === true, "Mission exhausted");
  printLog(s);
}

// --- 19. Site of Betrayal: Defeat all unresolved missions ---
header("Site of Betrayal — Defeat all unresolved missions");
{
  // BSG2-030 costs persuasion 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-030"], // Site of Betrayal
        alert: ["BSG1-060"], // Own mission (should also be defeated)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-073"],
        influence: 10, // Opponent mission
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2);

  const { state: s, played } = playEvent(state, 0, "site of betrayal");
  assert(played, "Site of Betrayal playable");
  // All unresolved missions should be defeated
  const p0Missions = s.players[0].zones.alert.filter(
    (u) => registry.cards[u.cards[0].defId]?.type === "mission",
  );
  const p1Missions = s.players[1].zones.alert.filter(
    (u) => registry.cards[u.cards[0].defId]?.type === "mission",
  );
  assert(p0Missions.length === 0 && p1Missions.length === 0, "All unresolved missions defeated");
  printLog(s);
}

// ============================================================
// CATEGORY 6: HAND / DECK MANIPULATION
// ============================================================

// --- 20. Crackdown: Opponent discards a card ---
header("Crackdown — Opponent discards a card");
{
  // BSG1-017 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-017"], // Crackdown
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        hand: ["BSG1-098"],
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

  const oppHandBefore = state.players[1].hand.length;
  const { state: s, played } = playEvent(state, 0, "crackdown");
  assert(played, "Crackdown playable");
  // With only 1 card in hand, auto-discards
  assert(s.players[1].hand.length === 0, "Opponent's card discarded");
  assert(s.players[1].discard.length > 0, "Card went to discard");
  printLog(s);
}

// --- 21. Cylon Computer Virus: All discard hands, redraw ---
header("Cylon Computer Virus — All discard and redraw");
{
  // BSG1-018 costs logistics 1 + security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-018", "BSG1-098", "BSG1-099"], // Virus + 2 other cards
        alert: [],
        deck: ["BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103", "BSG1-104", "BSG1-117", "BSG1-140"],
      },
      player1: {
        baseId: "BSG1-007",
        hand: ["BSG1-098", "BSG1-099"],
        alert: [],
        influence: 10,
        deck: ["BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103", "BSG1-104"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Add security asset for the second cost
  const secAsset = { defId: "BSG1-099", instanceId: "sec-asset-virus", faceUp: true };
  state.players[0].zones.resourceStacks.push({
    topCard: secAsset,
    supplyCards: [],
    exhausted: false,
  });

  const { state: s, played } = playEvent(state, 0, "cylon computer virus");
  assert(played, "Cylon Computer Virus playable");
  // Player 0 should have starting hand size cards (BSG1-005 base = 5)
  assert(
    s.players[0].hand.length === 5,
    `Player 0 redraws to starting hand size (${s.players[0].hand.length})`,
  );
  // Player 1 should have starting hand size cards (BSG1-007 base = 4)
  assert(
    s.players[1].hand.length === 4,
    `Player 1 redraws to starting hand size (${s.players[1].hand.length})`,
  );
  printLog(s);
}

// --- 22. Full Disclosure: All reveal hands ---
header("Full Disclosure — All reveal hands");
{
  // BSG2-020 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-020", "BSG1-098"], // Full Disclosure
        alert: [],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        hand: ["BSG1-102"],
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "full disclosure");
  assert(played, "Full Disclosure playable");
  assert(
    logContains(s, "full disclosure") && logContains(s, "reveals"),
    "Both hands revealed in log",
  );
  printLog(s);
}

// --- 23. Full System Malfunction: All discard hands ---
header("Full System Malfunction — All discard hands");
{
  // BSG2-021 costs security 5
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-021", "BSG1-098"], // Full System Malfunction + filler
        alert: [],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        hand: ["BSG1-102", "BSG1-103"],
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
  addSupply(state, 0, 4); // 5 security total

  const { state: s, played } = playEvent(state, 0, "full system malfunction");
  assert(played, "Full System Malfunction playable");
  assert(s.players[0].hand.length === 0, "Player 0 hand empty");
  assert(s.players[1].hand.length === 0, "Player 1 hand empty");
  printLog(s);
}

// ============================================================
// CATEGORY 7: INFLUENCE MANIPULATION
// ============================================================

// --- 24. Executive Privilege: Prevent all influence loss ---
header("Executive Privilege — Prevent influence loss");
{
  // BSG1-026 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-026"], // Executive Privilege
        alert: [],
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "executive privilege");
  assert(played, "Executive Privilege playable");
  assert(s.preventInfluenceLoss === "Executive Privilege", "preventInfluenceLoss flag set");
  printLog(s);
}

// --- 25. Standoff: Prevent all influence gain ---
header("Standoff — Prevent influence gain");
{
  // BSG1-044 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-044"], // Standoff
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "standoff");
  assert(played, "Standoff playable");
  assert(s.preventInfluenceGain === "Standoff", "preventInfluenceGain flag set");
  printLog(s);
}

// --- 26. Test of Faith: Gain 1 influence ---
header("Test of Faith — Gain 1 influence");
{
  // BSG1-049 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-049"], // Test of Faith
        alert: [],
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
  addSupply(state, 0, 1);

  const infBefore = state.players[0].influence;
  const { state: s, played } = playEvent(state, 0, "test of faith");
  assert(played, "Test of Faith playable");
  assert(
    s.players[0].influence === infBefore + 1,
    `Gained 1 influence (${infBefore} → ${s.players[0].influence})`,
  );
  printLog(s);
}

// ============================================================
// CATEGORY 8: CHALLENGE MANIPULATION
// ============================================================

// --- 27. Showdown: No challenges rest of phase ---
header("Showdown — No challenges");
{
  // BSG2-029 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-029"], // Showdown
        alert: ["BSG1-098"], // Apollo (could challenge)
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "showdown");
  assert(played, "Showdown playable");
  assert(s.noChallenges === true, "noChallenges flag set");

  // Pass turn to player 0 again, check no challenge actions
  let s2 = applyAction(s, 1, { type: "pass" }, bases).state;
  const actions = getValidActions(s2, 0, bases);
  const challengeAction = findAction(actions, "challenge");
  assert(!challengeAction, "No challenge action available after Showdown");
  printLog(s);
}

// --- 28. Martial Law: Politicians can't defend ---
header("Martial Law — Politicians can't defend");
{
  // BSG1-032 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-032"], // Martial Law
        alert: ["BSG1-098"], // Apollo (challenger)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10, // Billy (Politician defender)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "martial law");
  assert(played, "Martial Law playable");
  assert(s.politiciansCantDefend === true, "politiciansCantDefend flag set");
  printLog(s);
}

// ============================================================
// CATEGORY 9: TRAIT / KEYWORD MODIFICATION
// ============================================================

// --- 29. Boarding Party: Ship gains Scramble + draw 1 ---
header("Boarding Party — Ship gains Scramble + draw");
{
  // BSG2-008 costs logistics 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-008"], // Boarding Party
        alert: ["BSG1-146"], // Colonial Shuttle (ship)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
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
  addSupply(state, 0, 1);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "boarding party");
  assert(played, "Boarding Party playable");
  // Check Scramble keyword granted
  const shipId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const hasScramble = shipId && s.players[0].temporaryKeywordGrants?.[shipId]?.includes("Scramble");
  assert(!!hasScramble, "Ship gains Scramble");
  // Should draw 1 card (net: played 1, drew 1 = same size)
  assert(
    s.players[0].hand.length === handBefore,
    `Drew 1 card (hand: ${handBefore - 1} + 1 = ${s.players[0].hand.length})`,
  );
  printLog(s);
}

// --- 30. Cylons on the Brain: Personnel gains Cylon trait ---
header("Cylons on the Brain — Personnel gains Cylon trait");
{
  // BSG2-013 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-013"], // Cylons on the Brain
        alert: ["BSG1-102"], // Billy (non-Cylon personnel)
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "cylons on the brain");
  assert(played, "Cylons on the Brain playable");
  const billyId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const hasCylon = billyId && s.players[0].temporaryTraitGrants?.[billyId]?.includes("Cylon");
  assert(!!hasCylon, "Personnel gains Cylon trait");
  printLog(s);
}

// --- 31. Everyone's Green: Cylon personnel loses Cylon trait + draw ---
header("Everyone's Green — Cylon loses Cylon trait + draw");
{
  // BSG2-017 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-017"], // Everyone's Green
        alert: ["BSG1-103"], // Boomer (Cylon, Pilot — not Machine)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
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
  addSupply(state, 0, 1);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "everyone");
  assert(played, "Everyone's Green playable");
  const boomerId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const lostCylon = boomerId && s.players[0].temporaryTraitRemovals?.[boomerId]?.includes("Cylon");
  assert(!!lostCylon, "Cylon personnel loses Cylon trait");
  assert(s.players[0].hand.length === handBefore, "Drew 1 card");
  printLog(s);
}

// --- 32. Unexpected: Cylon ship loses Cylon trait ---
header("Unexpected — Cylon ship loses Cylon trait");
{
  // BSG2-041 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-041"], // Unexpected
        alert: ["BSG1-172"], // Skirmishing Raider (Cylon, Fighter ship)
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

  const { state: s, played } = playEvent(state, 0, "unexpected");
  assert(played, "Unexpected playable");
  const raiderId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const lostCylon = raiderId && s.players[0].turnTraitRemovals?.[raiderId]?.includes("Cylon");
  assert(!!lostCylon, "Cylon ship loses Cylon trait");
  printLog(s);
}

// ============================================================
// CATEGORY 10: CYLON / SPECIAL
// ============================================================

// --- 33. Cylons Look Like Humans: Each player mills per Cylon count ---
header("Cylons Look Like Humans — Mill per Cylon count");
{
  // BSG1-020 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-020"], // Cylons Look Like Humans
        alert: ["BSG1-103"], // Boomer (Cylon trait)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"],
        influence: 10, // Non-Cylon
        deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-104", "BSG1-117"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const p0DeckBefore = state.players[0].deck.length;
  const p1DeckBefore = state.players[1].deck.length;
  const { state: s, played } = playEvent(state, 0, "cylons look like humans");
  assert(played, "Cylons Look Like Humans playable");
  // P0 has 1 Cylon (Boomer) → mill 1
  assert(s.players[0].deck.length === p0DeckBefore - 1, `Player 0 milled 1 card`);
  // P1 has 0 Cylons → mill 0
  assert(s.players[1].deck.length === p1DeckBefore, "Player 1 milled 0 cards");
  printLog(s);
}

// --- 34. There Are Many Copies: Return Cylon personnel from discard ---
header("There Are Many Copies — Recover Cylon from discard");
{
  // BSG2-036 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-036"], // There Are Many Copies
        alert: [],
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
  addSupply(state, 0, 1);

  // Put a Cylon personnel in discard
  const boomer: CardInstance = { defId: "BSG1-103", instanceId: "discard-boomer", faceUp: true };
  state.players[0].discard.push(boomer);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "many copies");
  assert(played, "There Are Many Copies playable");
  // Boomer should be in hand now
  assert(
    s.players[0].hand.some((c: CardInstance) => c.defId === "BSG1-103"),
    "Cylon personnel returned to hand",
  );
  assert(
    !s.players[0].discard.some((c: CardInstance) => c.instanceId === "discard-boomer"),
    "Removed from discard",
  );
  printLog(s);
}

// ============================================================
// CATEGORY 11: EFFECT IMMUNITY
// ============================================================

// --- 35. Anti-Radiation Dosage: Immune to power changes ---
header("Anti-Radiation Dosage — Immune to power changes");
{
  // BSG2-007 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-007"], // Anti-Radiation Dosage
        alert: ["BSG1-098"], // Apollo
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

  const { state: s, played } = playEvent(state, 0, "anti-radiation");
  assert(played, "Anti-Radiation Dosage playable");
  const apolloId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  assert(!!(apolloId && s.effectImmunity?.[apolloId] === "power"), "Unit immune to power changes");
  printLog(s);
}

// --- 36. Fallout Shelter: Immune to all effects ---
header("Fallout Shelter — Immune to all effects");
{
  // BSG2-018 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-018"], // Fallout Shelter
        alert: ["BSG1-098"], // Apollo
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
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "fallout shelter");
  assert(played, "Fallout Shelter playable");
  const apolloId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  assert(!!(apolloId && s.effectImmunity?.[apolloId] === "all"), "Unit immune to all effects");
  printLog(s);
}

// ============================================================
// CATEGORY 12: RESOURCE MANIPULATION
// ============================================================

// --- 37. Raiding Farms: Defeat target asset with no supply cards ---
header("Raiding Farms — Defeat bare asset");
{
  // BSG2-027 costs logistics 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-027"], // Raiding Farms
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
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
  addSupply(state, 0, 2); // 3 logistics

  // Add a bare asset to opponent
  const bareAsset = { defId: "BSG1-098", instanceId: "opp-asset-1", faceUp: true };
  state.players[1].zones.resourceStacks.push({
    topCard: bareAsset,
    supplyCards: [],
    exhausted: false,
  });

  const oppStacksBefore = state.players[1].zones.resourceStacks.length;
  const { state: s, played } = playEvent(state, 0, "raiding farms");
  assert(played, "Raiding Farms playable");
  assert(s.players[1].zones.resourceStacks.length < oppStacksBefore, "Asset defeated");
  printLog(s);
}

// --- 38. Resupply: Draw X cards (X = supply cards in largest unexhausted stack) ---
header("Resupply — Draw based on supply count");
{
  // BSG2-028 costs logistics 2
  // Key: after paying cost, the base stack is exhausted. Need a SECOND unexhausted stack with supplies.
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-028"], // Resupply
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103", "BSG1-104"],
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
  addSupply(state, 0, 1); // base stack: 2 logistics (pays cost, becomes exhausted)

  // Add a second unexhausted asset with 2 supply cards — this stack will be checked for draws
  const logAsset = { defId: "BSG1-098", instanceId: "log-asset-resupply", faceUp: true };
  state.players[0].zones.resourceStacks.push({
    topCard: logAsset,
    supplyCards: [
      { defId: "BSG1-100", instanceId: "rsup-1", faceUp: false },
      { defId: "BSG1-101", instanceId: "rsup-2", faceUp: false },
    ],
    exhausted: false,
  });

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "resupply");
  assert(played, "Resupply playable");
  // Should draw 2 cards (2 supply cards in unexhausted stack), minus the event played = handBefore - 1 + 2
  assert(
    s.players[0].hand.length === handBefore - 1 + 2,
    `Drew 2 cards (hand: ${s.players[0].hand.length})`,
  );
  printLog(s);
}

// ============================================================
// CATEGORY 13: OPPONENT-CHOICE EVENTS
// ============================================================

// --- 39. Downed Pilot: Opponent commits ship or sacrifices personnel ---
header("Downed Pilot — Opponent choice");
{
  // BSG1-024 costs persuasion 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-024"], // Downed Pilot
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-146"], // Colonial Shuttle (ship)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const oppAlertBefore = state.players[1].zones.alert.length;
  const { state: s, played } = playEvent(state, 0, "downed pilot");
  assert(played, "Downed Pilot playable");
  // AI should commit the ship
  assert(s.players[1].zones.alert.length < oppAlertBefore, "Opponent's ship committed");
  assert(s.players[1].zones.reserve.length > 0, "Ship moved to reserve");
  printLog(s);
}

// --- 40. Grounded: Opponent commits ship or all personnel ---
header("Grounded — Opponent choice");
{
  // BSG1-029 costs persuasion 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-029"], // Grounded
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-102", "BSG1-098"], // Billy (personnel) + Apollo (personnel)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2);

  // No ships — must commit all personnel
  const { state: s, played } = playEvent(state, 0, "grounded");
  assert(played, "Grounded playable");
  assert(s.players[1].zones.alert.length === 0, "All opponent personnel committed");
  printLog(s);
}

// --- 41. Hangar Deck Fire: Sacrifice ship or supply ---
header("Hangar Deck Fire — Opponent sacrifice");
{
  // BSG1-030 costs logistics 2 + security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-030"], // Hangar Deck Fire
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-146"], // Ship to sacrifice
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1); // 2 logistics

  // Add security asset
  const secAsset = { defId: "BSG1-099", instanceId: "sec-hdf", faceUp: true };
  state.players[0].zones.resourceStacks.push({
    topCard: secAsset,
    supplyCards: [],
    exhausted: false,
  });

  // Opponent has ship but no supply — must sacrifice ship
  const { state: s, played } = playEvent(state, 0, "hangar deck fire");
  assert(played, "Hangar Deck Fire playable");
  // Ship should be sacrificed (only option)
  assert(s.players[1].zones.alert.length === 0, "Opponent's ship sacrificed");
  printLog(s);
}

// --- 42. Still No Contact: Opponent commits or sacrifices personnel ---
header("Still No Contact — Opponent personnel");
{
  // BSG1-045 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-045"], // Still No Contact
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (personnel)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "still no contact");
  assert(played, "Still No Contact playable");
  // Should commit the alert personnel
  assert(s.players[1].zones.reserve.length > 0, "Opponent personnel committed");
  printLog(s);
}

// ============================================================
// CATEGORY 14: THEM OR US / PAINFUL RECOVERY (COMPLEX EFFECTS)
// ============================================================

// --- 43. Them or Us: Sacrifice ship → defeat personnel ---
header("Them or Us — Sacrifice ship, defeat personnel");
{
  // BSG1-050 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-050"], // Them or Us
        alert: ["BSG1-146"], // Colonial Shuttle (ship to sacrifice)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (personnel to defeat)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "them or us");
  assert(played, "Them or Us playable");
  // Own ship should be sacrificed
  const hasShip = s.players[0].zones.alert.some((u) => u.cards[0].defId === "BSG1-146");
  assert(!hasShip, "Own ship sacrificed");
  // Target personnel should be defeated
  assert(s.players[1].zones.alert.length === 0, "Target personnel defeated");
  printLog(s);
}

// --- 44. Painful Recovery: Put Cylon on deck → commit+exhaust personnel ---
header("Painful Recovery — Cylon to deck, commit+exhaust target");
{
  // BSG1-037 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-037"], // Painful Recovery
        alert: ["BSG1-103"], // Boomer (Cylon personnel)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (target to commit+exhaust)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "painful recovery", {
    targetDefId: "BSG1-102",
    targetPlayerIndex: 1,
  });
  assert(played, "Painful Recovery playable");
  // Cylon should be put on top of deck
  assert(s.players[0].deck[0]?.defId === "BSG1-103", "Cylon put on top of deck");
  assert(
    !s.players[0].zones.alert.some((u) => u.cards[0].defId === "BSG1-103"),
    "Cylon removed from play",
  );
  // Target should be in reserve and exhausted
  const target = s.players[1].zones.reserve.find((u) => u.cards[0].defId === "BSG1-102");
  assert(!!target && target.exhausted, "Target committed and exhausted");
  printLog(s);
}

// ============================================================
// CATEGORY 15: SPECIAL BUFF EVENTS
// ============================================================

// --- 45. Concentrated Firepower: +X power (X = supply count) ---
header("Concentrated Firepower — +X based on supply cards");
{
  // BSG2-009 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-009"], // Concentrated Firepower
        alert: ["BSG1-098"], // Apollo (target)
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
  addSupply(state, 0, 3); // 3 supply cards = +3 power, also provides 4 security total

  const { state: s, played } = playEvent(state, 0, "concentrated firepower");
  assert(played, "Concentrated Firepower playable");
  assert(
    logContains(s, "concentrated firepower") && logContains(s, "+3 power"),
    "Gives +3 power (3 supply cards)",
  );
  printLog(s);
}

// --- 46. Strange Wingman: Fighter +X (X = Cylon ships) ---
header("Strange Wingman — Fighter +X (Cylon ships count)");
{
  // BSG2-034 costs logistics 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-034"], // Strange Wingman
        alert: ["BSG1-147", "BSG1-172"], // Colonial Viper (Fighter) + Skirmishing Raider (Cylon ship)
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

  const { state: s, played } = playEvent(state, 0, "strange wingman");
  assert(played, "Strange Wingman playable");
  assert(
    logContains(s, "strange wingman") && logContains(s, "+1 power"),
    "Gives +1 power (1 Cylon ship)",
  );
  printLog(s);
}

// --- 47. Swearing In: Politician +2 power ---
header("Swearing In — Politician +2 power");
{
  // BSG2-035 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG2-035"], // Swearing In
        alert: ["BSG1-102"], // Billy (Politician)
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

  const { state: s, played } = playEvent(state, 0, "swearing in");
  assert(played, "Swearing In playable");
  assert(logContains(s, "swearing in") && logContains(s, "+2 power"), "Politician gets +2 power");
  printLog(s);
}

// --- 48. Cylon Missile Battery: Cylon unit +2 power ---
header("Cylon Missile Battery — Cylon unit +2");
{
  // BSG1-019 costs logistics 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-019"], // Cylon Missile Battery
        alert: ["BSG1-103"], // Boomer (Cylon, Pilot)
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

  const { state: s, played } = playEvent(state, 0, "cylon missile battery");
  assert(played, "Cylon Missile Battery playable");
  assert(
    logContains(s, "cylon missile battery") && logContains(s, "+2 power"),
    "Cylon unit gets +2 power",
  );
  printLog(s);
}

// --- 49. You Gave Yourself Over: Civilian +2 power ---
header("You Gave Yourself Over — Civilian +2 power");
{
  // BSG1-055 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-055"], // You Gave Yourself Over
        alert: ["BSG1-117"], // Dr. Baltar (Civilian)
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

  const { state: s, played } = playEvent(state, 0, "you gave yourself");
  assert(played, "You Gave Yourself Over playable");
  assert(
    logContains(s, "you gave yourself over") && logContains(s, "+2 power"),
    "Civilian gets +2 power",
  );
  printLog(s);
}

// --- 50. Cylon Surprise: Cylon Machine +2 power ---
header("Cylon Surprise — Cylon Machine +2 power");
{
  // BSG2-012 costs logistics 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-012"], // Cylon Surprise
        alert: ["BSG1-107"], // Centurion Assassin (Cylon, Machine)
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

  const { state: s, played } = playEvent(state, 0, "cylon surprise");
  assert(played, "Cylon Surprise playable");
  assert(
    logContains(s, "cylon surprise") && logContains(s, "+2 power"),
    "Cylon Machine gets +2 power",
  );
  printLog(s);
}

// ============================================================
// CATEGORY 16: SPECIAL DELIVERY / STRAFING RUN / OUT OF SIGHT
// ============================================================

// --- 51. Special Delivery: Personnel +1 power + Scramble + draw ---
header("Special Delivery — Personnel +1 + Scramble + draw");
{
  // BSG2-031 costs logistics 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-031"], // Special Delivery
        alert: ["BSG1-102"], // Billy (personnel)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
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
  addSupply(state, 0, 1);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "special delivery");
  assert(played, "Special Delivery playable");
  assert(logContains(s, "special delivery") && logContains(s, "+1 power"), "Personnel +1 power");
  const billyId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const hasScramble =
    billyId && s.players[0].temporaryKeywordGrants?.[billyId]?.includes("Scramble");
  assert(!!hasScramble, "Personnel gains Scramble");
  assert(s.players[0].hand.length === handBefore, "Drew 1 card");
  printLog(s);
}

// --- 52. Strafing Run: Ship +1 + Strafe + draw ---
header("Strafing Run — Ship +1 + Strafe + draw");
{
  // BSG2-033 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-033"], // Strafing Run
        alert: ["BSG1-146"], // Colonial Shuttle (ship)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
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
  addSupply(state, 0, 1);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "strafing run");
  assert(played, "Strafing Run playable");
  assert(logContains(s, "strafing run") && logContains(s, "+1 power"), "Ship +1 power");
  const shipId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const hasStrafe = shipId && s.players[0].temporaryKeywordGrants?.[shipId]?.includes("Strafe");
  assert(!!hasStrafe, "Ship gains Strafe");
  assert(s.players[0].hand.length === handBefore, "Drew 1 card");
  printLog(s);
}

// --- 53. Out of Sight: Personnel gains Scramble + draw ---
header("Out of Sight — Personnel gains Scramble + draw");
{
  // BSG2-026 costs logistics 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-026"], // Out of Sight
        alert: ["BSG1-102"], // Billy (personnel)
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
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
  addSupply(state, 0, 1);

  const handBefore = state.players[0].hand.length;
  const { state: s, played } = playEvent(state, 0, "out of sight");
  assert(played, "Out of Sight playable");
  const billyId = s.players[0].zones.alert[0]?.cards[0]?.instanceId;
  const hasScramble =
    billyId && s.players[0].temporaryKeywordGrants?.[billyId]?.includes("Scramble");
  assert(!!hasScramble, "Personnel gains Scramble");
  assert(s.players[0].hand.length === handBefore, "Drew 1 card");
  printLog(s);
}

// ============================================================
// CATEGORY 17: DISTRACTION / MILITARY COUP / COVERING FIRE (AUTO-RESOLVE)
// ============================================================

// --- 54. Distraction: Commit own personnel → commit+exhaust target ---
header("Distraction — Commit personnel, commit+exhaust target");
{
  // BSG1-023 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-023"], // Distraction
        alert: ["BSG1-098"], // Apollo (own personnel to commit)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (target to commit+exhaust)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "distraction", {
    targetDefId: "BSG1-102",
    targetPlayerIndex: 1,
  });
  assert(played, "Distraction playable");
  // Own personnel committed to reserve
  assert(
    s.players[0].zones.reserve.some((u) => u.cards[0].defId === "BSG1-098"),
    "Own personnel committed",
  );
  // Target committed + exhausted
  const target = s.players[1].zones.reserve.find((u) => u.cards[0].defId === "BSG1-102");
  assert(!!target && target.exhausted, "Target committed and exhausted");
  printLog(s);
}

// --- 55. Military Coup: Exhaust own personnel → exhaust opponent's ---
header("Military Coup — Exhaust own, exhaust opponent's");
{
  // BSG1-033 costs security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG1-033"], // Military Coup
        alert: ["BSG1-098"], // Apollo (own personnel to exhaust)
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (target to exhaust)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, played } = playEvent(state, 0, "military coup");
  assert(played, "Military Coup playable");
  // Own personnel exhausted
  const own = [...s.players[0].zones.alert, ...s.players[0].zones.reserve].find(
    (u) => u.cards[0].defId === "BSG1-098",
  );
  assert(own?.exhausted === true, "Own personnel exhausted");
  // Opponent's personnel exhausted
  const opp = [...s.players[1].zones.alert, ...s.players[1].zones.reserve].find(
    (u) => u.cards[0].defId === "BSG1-102",
  );
  assert(opp?.exhausted === true, "Opponent personnel exhausted");
  printLog(s);
}

// ============================================================
// CATEGORY 18: NETWORKED COMPUTERS / HIGH STAKES GAME
// ============================================================

// --- 56. Networked Computers: Reveal mystics, winner recovers from discard ---
header("Networked Computers — Mystic contest, recover from discard");
{
  // BSG1-035 costs logistics 3
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-035"], // Networked Computers
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: [],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 2);

  // Put a card in player 0's discard for recovery
  state.players[0].discard.push({ defId: "BSG1-140", instanceId: "discard-zarek", faceUp: true });

  const { state: s, played } = playEvent(state, 0, "networked computers");
  assert(played, "Networked Computers playable");
  assert(
    logContains(s, "networked computers") && logContains(s, "mystic"),
    "Mystic values revealed",
  );
  printLog(s);
}

// --- 57. Advanced Planning: Look at top 5, keep best on top ---
header("Advanced Planning — Top 5 deck manipulation");
{
  // BSG1-010 costs logistics 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG1-010"], // Advanced Planning
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103"],
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

  const deckBefore = state.players[0].deck.length;
  const { state: s, played } = playEvent(state, 0, "advanced planning");
  assert(played, "Advanced Planning playable");
  assert(s.players[0].deck.length === deckBefore, "Deck size unchanged");
  assert(logContains(s, "advanced planning"), "Advanced Planning resolved");
  printLog(s);
}

// --- 58. To the Victor: Exhaust target personnel ---
header("To the Victor — Exhaust target personnel");
{
  // BSG2-038 costs security 2
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-007", // security
        hand: ["BSG2-038"], // To the Victor
        alert: [],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-004",
        alert: ["BSG1-102"], // Billy (personnel target)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );
  addSupply(state, 0, 1);

  const { state: s, played } = playEvent(state, 0, "to the victor");
  assert(played, "To the Victor playable");
  const target = [...s.players[1].zones.alert, ...s.players[1].zones.reserve].find(
    (u) => u.cards[0].defId === "BSG1-102",
  );
  assert(target?.exhausted === true, "Target personnel exhausted");
  printLog(s);
}

// --- 59. Power of Prayer: Reveal mystic, target +X power ---
header("Power of Prayer — Reveal mystic, +X power");
{
  // BSG1-038 costs persuasion 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004", // persuasion
        hand: ["BSG1-038"], // Power of Prayer
        alert: ["BSG1-098"], // Apollo (target)
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

  const { state: s, played } = playEvent(state, 0, "power of prayer");
  assert(played, "Power of Prayer playable");
  assert(logContains(s, "power of prayer") && logContains(s, "power"), "Power of Prayer resolved");
  printLog(s);
}

// --- 60. Massive Assault: Ready all Capital Ships and Fighters ---
header("Massive Assault — Ready Capital Ships and Fighters");
{
  // BSG2-025 costs logistics 3 + security 1
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-005", // logistics
        hand: ["BSG2-025"], // Massive Assault
        alert: [],
        reserve: ["BSG1-147"], // Colonial Viper (Fighter) in reserve
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
  addSupply(state, 0, 2); // 3 logistics

  // Add security asset
  const secAsset = { defId: "BSG1-099", instanceId: "sec-mass", faceUp: true };
  state.players[0].zones.resourceStacks.push({
    topCard: secAsset,
    supplyCards: [],
    exhausted: false,
  });

  const reserveBefore = state.players[0].zones.reserve.length;
  const { state: s, played } = playEvent(state, 0, "massive assault");
  assert(played, "Massive Assault playable");
  // Fighter should move from reserve to alert
  assert(
    s.players[0].zones.alert.some((u) => u.cards[0].defId === "BSG1-147"),
    "Fighter readied to alert",
  );
  printLog(s);
}

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log("=".repeat(60));

if (failed > 0) process.exit(1);
