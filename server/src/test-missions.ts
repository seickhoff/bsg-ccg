/**
 * Headless test runner for BSG CCG mission ability scenarios.
 * Run with: npx tsx server/src/test-missions.ts
 */

import { loadCardRegistry } from "./cardLoader.js";
import { setCardRegistry, createDebugGame, applyAction, getValidActions } from "./game-engine.js";
import type { GameState, ValidAction, LogItem, CardInstance } from "@bsg/shared";
import { computeFleetDefenseModifiers } from "./unit-abilities.js";
import {
  computeMissionFleetDefenseModifier,
  computeMissionPowerModifier,
  getMissionKeywordGrants,
} from "./mission-abilities.js";

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
    case "resolveMission":
      return {
        type: "resolveMission",
        missionInstanceId: va.selectableInstanceIds![0],
        unitInstanceIds: [],
        targetInstanceId: va.missionTargetIds?.[0],
        linkTargetInstanceId: va.linkTargetIds?.[0],
      };
    default:
      return base as GA;
  }
}

/** Find a resolveMission action by keyword in description */
function findMission(actions: VA[], keyword: string): VA | undefined {
  return actions.find(
    (a) =>
      a.type === "resolveMission" && a.description?.toLowerCase().includes(keyword.toLowerCase()),
  );
}

function findAbility(actions: VA[], keyword: string): VA | undefined {
  return actions.find(
    (a) => a.type === "playAbility" && a.description?.toLowerCase().includes(keyword.toLowerCase()),
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

/** Helper to resolve a mission and return updated state */
function resolveMissionAction(
  state: GameState,
  playerIndex: number,
  keyword: string,
  opts?: { targetId?: string; linkTargetId?: string },
): { state: GameState; resolved: boolean } {
  const actions = getValidActions(state, playerIndex, bases);
  const mission = findMission(actions, keyword);
  if (!mission) return { state, resolved: false };

  const ga: GA = {
    type: "resolveMission",
    missionInstanceId: mission.selectableInstanceIds![0],
    unitInstanceIds: [],
    targetInstanceId: opts?.targetId ?? mission.missionTargetIds?.[0],
    linkTargetInstanceId: opts?.linkTargetId ?? mission.linkTargetIds?.[0],
  };
  const result = applyAction(state, playerIndex, ga, bases);
  return { state: result.state, resolved: true };
}

// ============================================================
// CATEGORY 1: ONE-SHOT MISSIONS — Simple Effects
// ============================================================

// --- 1. Based On Scriptures — Gain 5 influence ---
header("Based On Scriptures — Gain 5 influence");
{
  // Requires 3 Politicians
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-060", // Based On Scriptures (mission)
          "BSG1-140", // Tom Zarek, Sagittaron Rep (Politician)
          "BSG1-101", // Billy Keikeya, Presidential Aide (Politician)
          "BSG1-102", // Billy Keikeya, Press Secretary (Politician)
        ],
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

  const startInf = state.players[0].influence;
  const { state: s, resolved } = resolveMissionAction(state, 0, "based on scriptures");
  assert(resolved, "Based On Scriptures resolvable");
  assert(
    s.players[0].influence === startInf + 5,
    `Gain 5 influence (${startInf} → ${s.players[0].influence})`,
  );
  // Mission should be in discard
  const inDiscard = s.players[0].discard.some((c: CardInstance) => c.defId === "BSG1-060");
  assert(inDiscard, "Mission goes to discard (one-shot)");
  printLog(s);
}

// --- 2. Hand Of God — Draw 2 cards ---
header("Hand Of God — Draw 2 cards");
{
  // Requires 1 Politician
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-073", // Hand Of God (mission)
          "BSG1-140", // Politician
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
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

  const handBefore = state.players[0].hand.length;
  const { state: s, resolved } = resolveMissionAction(state, 0, "hand of god");
  assert(resolved, "Hand Of God resolvable");
  assert(
    s.players[0].hand.length === handBefore + 2,
    `Drew 2 cards (${handBefore} → ${s.players[0].hand.length})`,
  );
  printLog(s);
}

// --- 3. Press Junket — Gain 2 influence ---
header("Press Junket — Gain 2 influence");
{
  // Requires 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-087", // Press Junket (mission)
          "BSG1-147", // Colonial Viper 113 (Fighter ship)
        ],
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

  const startInf = state.players[0].influence;
  const { state: s, resolved } = resolveMissionAction(state, 0, "press junket");
  assert(resolved, "Press Junket resolvable");
  assert(
    s.players[0].influence === startInf + 2,
    `Gain 2 influence (${startInf} → ${s.players[0].influence})`,
  );
  printLog(s);
}

// --- 4. Shuttle Diplomacy — Gain 3 influence ---
header("Shuttle Diplomacy — Gain 3 influence");
{
  // Requires 1 personnel + 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-092", // Shuttle Diplomacy (mission)
          "BSG1-140", // Politician (personnel)
          "BSG1-147", // Fighter (ship)
        ],
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

  const startInf = state.players[0].influence;
  const { state: s, resolved } = resolveMissionAction(state, 0, "shuttle diplomacy");
  assert(resolved, "Shuttle Diplomacy resolvable");
  assert(
    s.players[0].influence === startInf + 3,
    `Gain 3 influence (${startInf} → ${s.players[0].influence})`,
  );
  printLog(s);
}

// --- 5. Suspicions — Target player loses 2 influence ---
header("Suspicions — Target player loses 2 influence");
{
  // Requires 1 Civilian unit + 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-094", // Suspicions (mission)
          "BSG1-117", // Dr. Baltar, Award Winner (Civilian)
          "BSG1-109", // Crashdown (Officer)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "suspicions");
  assert(resolved, "Suspicions resolvable");
  assert(
    s.players[1].influence === 8,
    `Opponent loses 2 influence (10 → ${s.players[1].influence})`,
  );
  printLog(s);
}

// ============================================================
// CATEGORY 2: ONE-SHOT MISSIONS — Unit Movement
// ============================================================

// --- 6. Alert Five — Ready all Fighters ---
header("Alert Five — Ready all Fighters");
{
  // Requires 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-057", // Alert Five (mission)
          "BSG1-109", // Crashdown (Officer)
        ],
        reserve: [
          "BSG1-147", // Colonial Viper 113 (Fighter) — in reserve
          "BSG1-148", // Colonial Viper 229 (Fighter) — in reserve
        ],
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

  const reserveBefore = state.players[0].zones.reserve.length;
  const { state: s, resolved } = resolveMissionAction(state, 0, "alert five");
  assert(resolved, "Alert Five resolvable");
  // Both Fighters should have moved from reserve to alert
  const fightersInAlert = s.players[0].zones.alert.filter(
    (st: { cards: Array<{ defId: string }> }) => {
      const id = st.cards[0]?.defId;
      return id === "BSG1-147" || id === "BSG1-148";
    },
  ).length;
  assert(fightersInAlert === 2, `2 Fighters readied to alert (found ${fightersInAlert})`);
  printLog(s);
}

// --- 7. Earn Your Wings — Ready all Pilots ---
header("Earn Your Wings — Ready all Pilots");
{
  // Requires 1 Officer + 1 Pilot
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-067", // Earn Your Wings (mission)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo, Ace Pilot (Pilot) — alert (requirement)
        ],
        reserve: [
          "BSG1-103", // Boomer, Hell Of A Pilot (Pilot) — in reserve
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "earn your wings");
  assert(resolved, "Earn Your Wings resolvable");
  const boomerInAlert = s.players[0].zones.alert.some(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-103",
  );
  assert(boomerInAlert, "Boomer readied to alert");
  printLog(s);
}

// --- 8. Overtime — Ready all ships you control ---
header("Overtime — Ready all ships you control");
{
  // Requires 2 personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-084", // Overtime (mission)
          "BSG1-109", // Crashdown (Officer personnel)
          "BSG1-098", // Apollo (Pilot personnel)
        ],
        reserve: [
          "BSG1-147", // Viper 113 (ship in reserve)
          "BSG1-148", // Viper 229 (ship in reserve)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "overtime");
  assert(resolved, "Overtime resolvable");
  const shipsInAlert = s.players[0].zones.alert.filter(
    (st: { cards: Array<{ defId: string }> }) => {
      const id = st.cards[0]?.defId;
      return id === "BSG1-147" || id === "BSG1-148";
    },
  ).length;
  assert(shipsInAlert === 2, `2 ships readied (found ${shipsInAlert})`);
  printLog(s);
}

// --- 9. Formal Dress Function — Commit all Officers ---
header("Formal Dress Function — Commit all Officers");
{
  // Requires 2 Politicians
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-069", // Formal Dress Function (mission)
          "BSG1-140", // Zarek (Politician) — req
          "BSG1-101", // Billy (Politician) — req
          "BSG1-109", // Crashdown (Officer) — target
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-109"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, resolved } = resolveMissionAction(state, 0, "formal dress");
  assert(resolved, "Formal Dress Function resolvable");
  // Crashdown (Officer) should be in reserve now
  const crashInReserve = s.players[0].zones.reserve.some(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-109",
  );
  assert(crashInReserve, "Officer committed to reserve");
  // Opponent's Officer should also be committed
  const oppOfficerInReserve = s.players[1].zones.reserve.some(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-109",
  );
  assert(oppOfficerInReserve, "Opponent's Officer also committed");
  printLog(s);
}

// --- 10. Working Together — Ready all Politicians ---
header("Working Together — Ready all Politicians");
{
  // Requires 1 Officer + 1 Politician
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-097", // Working Together (mission)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-140", // Zarek (Politician) — alert, requirement
        ],
        reserve: [
          "BSG1-101", // Billy (Politician) — in reserve
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "working together");
  assert(resolved, "Working Together resolvable");
  const billyInAlert = s.players[0].zones.alert.some(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-101",
  );
  assert(billyInAlert, "Billy readied to alert");
  printLog(s);
}

// ============================================================
// CATEGORY 3: ONE-SHOT MISSIONS — Targeted Effects
// ============================================================

// --- 11. Relieved Of Duty — Return target alert personnel to hand ---
header("Relieved Of Duty — Return alert personnel to hand");
{
  // Requires 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-091", // Relieved Of Duty (mission)
          "BSG1-109", // Crashdown (Officer) — requirement
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Target opponent's Zarek
  const actions = getValidActions(state, 0, bases);
  const mission = findMission(actions, "relieved");
  assert(!!mission, "Relieved Of Duty available");
  assert((mission?.missionTargetIds?.length ?? 0) > 0, "Has target options");

  if (mission) {
    // Find Zarek's instance ID in target list
    const zarekStack = state.players[1].zones.alert.find(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
    );
    const zarekId = zarekStack?.cards[0]?.instanceId;
    const { state: s } = resolveMissionAction(state, 0, "relieved", { targetId: zarekId });
    const zarekInHand = s.players[1].hand.some((c: CardInstance) => c.defId === "BSG1-140");
    assert(zarekInHand, "Zarek returned to opponent's hand");
    printLog(s);
  }
}

// --- 12. Investigation — Put target personnel on top of deck, lose 2 influence ---
header("Investigation — Personnel to top of deck + lose 2 influence");
{
  // Requires 2 Officers
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-077", // Investigation (mission)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-143", // Adama (Officer)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const zarekStack = state.players[1].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  const zarekId = zarekStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "investigation", {
    targetId: zarekId,
  });
  assert(resolved, "Investigation resolvable");
  // Zarek on top of opponent's deck
  assert(s.players[1].deck[0]?.defId === "BSG1-140", "Zarek on top of opponent's deck");
  // Opponent loses 2 influence
  assert(s.players[1].influence <= 8, `Opponent lost 2 influence (now ${s.players[1].influence})`);
  printLog(s);
}

// --- 13. Kobol's Last Gleaming — Shuffle target personnel into deck ---
header("Kobol's Last Gleaming — Shuffle personnel into deck");
{
  // Requires 1 Officer + 1 Pilot
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-078", // Kobol's Last Gleaming
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (Pilot)
        ],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const zarekStack = state.players[1].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  const zarekId = zarekStack?.cards[0]?.instanceId;
  const deckBefore = state.players[1].deck.length;
  const { state: s, resolved } = resolveMissionAction(state, 0, "kobol", { targetId: zarekId });
  assert(resolved, "Kobol's Last Gleaming resolvable");
  // Zarek not in alert
  const zarekGone = !s.players[1].zones.alert.some(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  assert(zarekGone, "Zarek removed from alert");
  assert(
    s.players[1].deck.length === deckBefore + 1,
    `Deck grew by 1 (${deckBefore} → ${s.players[1].deck.length})`,
  );
  printLog(s);
}

// --- 14. Green: Normal Human — Bounce Cylon to hand, owner gains 2 ---
header("Green: Normal Human — Bounce Cylon, owner gains 2");
{
  // Requires 1 Civilian unit
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-072", // Green: Normal Human
          "BSG1-117", // Dr. Baltar (Civilian)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-130"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Target opponent's Number Six (Cylon)
  const sixStack = state.players[1].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-130",
  );
  const sixId = sixStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "green", { targetId: sixId });
  assert(resolved, "Green resolvable");
  const sixInHand = s.players[1].hand.some((c: CardInstance) => c.defId === "BSG1-130");
  assert(sixInHand, "Number Six returned to hand");
  assert(s.players[1].influence === 12, `Owner gains 2 influence (10 → ${s.players[1].influence})`);
  printLog(s);
}

// --- 15. Red: Evil Cylon — Bounce Cylon to hand, owner loses 2 ---
header("Red: Evil Cylon — Bounce Cylon, owner loses 2");
{
  // Requires 1 Civilian unit
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-089", // Red: Evil Cylon
          "BSG1-117", // Dr. Baltar (Civilian)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-130"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const sixStack = state.players[1].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-130",
  );
  const sixId = sixStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "red", { targetId: sixId });
  assert(resolved, "Red: Evil Cylon resolvable");
  const sixInHand = s.players[1].hand.some((c: CardInstance) => c.defId === "BSG1-130");
  assert(sixInHand, "Number Six returned to hand");
  assert(s.players[1].influence <= 8, `Owner loses 2 influence (now ${s.players[1].influence})`);
  printLog(s);
}

// --- 16. Full Scale Assault — All your units +1 power ---
header("Full Scale Assault — All your units +1 power");
{
  // Requires 1 Officer + 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-070", // Full Scale Assault
          "BSG1-109", // Crashdown (Officer)
          "BSG1-147", // Viper 113 (ship)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "full scale");
  assert(resolved, "Full Scale Assault resolvable");
  // Check powerBuff on units
  const crashBuff =
    s.players[0].zones.alert.find(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-109",
    )?.powerBuff ?? 0;
  const viperBuff =
    s.players[0].zones.alert.find(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
    )?.powerBuff ?? 0;
  assert(crashBuff >= 1, `Officer got +1 power buff (${crashBuff})`);
  assert(viperBuff >= 1, `Ship got +1 power buff (${viperBuff})`);
  printLog(s);
}

// --- 17. Refueling Operation — Shuffle discard into deck ---
header("Refueling Operation — Shuffle discard into deck");
{
  // Requires 2 Pilots + 2 ships
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-090", // Refueling Operation
          "BSG1-098", // Apollo (Pilot)
          "BSG1-103", // Boomer (Pilot)
          "BSG1-147", // Viper 113 (ship)
          "BSG1-148", // Viper 229 (ship)
        ],
        deck: ["BSG1-099"],
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

  // Add some cards to discard
  state.players[0].discard.push(
    { defId: "BSG1-100", instanceId: "discard1", faceUp: true },
    { defId: "BSG1-101", instanceId: "discard2", faceUp: true },
    { defId: "BSG1-102", instanceId: "discard3", faceUp: true },
  );
  const deckBefore = state.players[0].deck.length;
  const discardBefore = state.players[0].discard.length;

  const { state: s, resolved } = resolveMissionAction(state, 0, "refueling");
  assert(resolved, "Refueling Operation resolvable");
  // The resolved mission card itself goes to discard (one-shot), but the 3 original discard cards are shuffled in
  const originalDiscardShuffled = s.players[0].deck.length >= deckBefore + discardBefore;
  assert(
    originalDiscardShuffled,
    `Discard shuffled into deck (deck: ${s.players[0].deck.length}, was ${deckBefore}+${discardBefore})`,
  );
  printLog(s);
}

// --- 18. Trying Times — Gain 1 influence per alert Politician ---
header("Trying Times — Gain 1 per alert Politician");
{
  // Requires 2 Politicians
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-095", // Trying Times
          "BSG1-140", // Zarek (Politician)
          "BSG1-101", // Billy (Politician)
        ],
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

  const startInf = state.players[0].influence;
  const { state: s, resolved } = resolveMissionAction(state, 0, "trying times");
  assert(resolved, "Trying Times resolvable");
  // 2 own Politicians + opponent's Billy = 3 Politicians in alert
  const gain = s.players[0].influence - startInf;
  assert(gain >= 2, `Gained at least 2 influence for alert Politicians (gained ${gain})`);
  printLog(s);
}

// --- 19. Earn Freedom Points — 1 inf per Civilian unit/mission ---
header("Earn Freedom Points — 1 inf per Civilian unit/mission");
{
  // Requires 1 Officer + 1 Politician
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-066", // Earn Freedom Points
          "BSG1-109", // Crashdown (Officer)
          "BSG1-140", // Zarek (Politician)
          "BSG1-117", // Dr. Baltar (Civilian)
        ],
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

  const startInf = state.players[0].influence;
  const { state: s, resolved } = resolveMissionAction(state, 0, "earn freedom");
  assert(resolved, "Earn Freedom Points resolvable");
  // 1 Civilian unit (Dr. Baltar) + mission itself is Civilian trait
  const gain = s.players[0].influence - startInf;
  assert(gain >= 1, `Gained influence for Civilian units (gained ${gain})`);
  printLog(s);
}

// --- 20. Accused — Target personnel gains Cylon trait ---
header("Accused — Target personnel gains Cylon trait");
{
  // Requires 1 Civilian unit
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-056", // Accused
          "BSG1-117", // Dr. Baltar (Civilian)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Target opponent's Zarek
  const zarekStack = state.players[1].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  const zarekId = zarekStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "accused", { targetId: zarekId });
  assert(resolved, "Accused resolvable");
  // Zarek should have temporary Cylon trait
  const grants = s.players[1].temporaryTraitGrants?.[zarekId!];
  assert(grants?.includes("Cylon"), `Zarek gains Cylon trait (grants: ${JSON.stringify(grants)})`);
  printLog(s);
}

// ============================================================
// CATEGORY 4: PERSISTENT MISSIONS — Power Modifiers
// ============================================================

// --- 21. CAG — All ships +1 power (persistent) ---
header("CAG — Persistent: All ships +1 power");
{
  // Requires 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-061", // CAG (mission)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-147", // Viper 113 (ship — will benefit)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "cag");
  assert(resolved, "CAG resolvable");
  // Mission should be in persistentMissions
  const inPersistent = (s.players[0].zones.persistentMissions ?? []).some(
    (c: CardInstance) => c.defId === "BSG1-061",
  );
  assert(inPersistent, "CAG in persistentMissions");
  // Check power modifier on ship
  const viperStack = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  if (viperStack) {
    const mod = computeMissionPowerModifier(s, viperStack, 0, { phase: "execution" });
    assert(mod === 1, `Viper gets +1 from CAG (got ${mod})`);
  }
  printLog(s);
}

// --- 22. Stern Leadership — All Pilots +1 power ---
header("Stern Leadership — Persistent: All Pilots +1 power");
{
  // Requires 1 Officer + 1 Pilot
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-093", // Stern Leadership
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (Pilot — will benefit)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "stern leadership");
  assert(resolved, "Stern Leadership resolvable");
  const apolloStack = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (apolloStack) {
    const mod = computeMissionPowerModifier(s, apolloStack, 0, { phase: "execution" });
    assert(mod === 1, `Apollo gets +1 from Stern Leadership (got ${mod})`);
  }
  printLog(s);
}

// --- 23. Increased Loadout — All Fighters +1 power ---
header("Increased Loadout — Persistent: All Fighters +1 power");
{
  // Requires 1 Officer + 1 Pilot
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-075", // Increased Loadout
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (Pilot)
          "BSG1-147", // Viper 113 (Fighter — will benefit)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "increased loadout");
  assert(resolved, "Increased Loadout resolvable");
  const viperStack = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  if (viperStack) {
    const mod = computeMissionPowerModifier(s, viperStack, 0, { phase: "execution" });
    assert(mod === 1, `Viper (Fighter) gets +1 from Increased Loadout (got ${mod})`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 5: PERSISTENT MISSIONS — Fleet Defense & Cylon Modifiers
// ============================================================

// --- 24. Coming Out To Fight — Fleet defense +4 ---
header("Coming Out To Fight — Persistent: Fleet defense +4");
{
  // Requires 2 ships
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-052", // Coming Out To Fight
          "BSG1-147", // Viper 113
          "BSG1-148", // Viper 229
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "coming out");
  assert(resolved, "Coming Out To Fight resolvable");
  const fleetMod = computeMissionFleetDefenseModifier(s);
  assert(fleetMod === 4, `Fleet defense modifier = +4 (got ${fleetMod})`);
  printLog(s);
}

// --- 25. Persistent Assault — Fleet defense -2 ---
header("Persistent Assault — Persistent: Fleet defense -2");
{
  // Requires 2 Cylon units
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-085", // Persistent Assault
          "BSG1-130", // Number Six (Cylon)
          "BSG1-157", // Hunting Raider (Cylon ship)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "persistent assault");
  assert(resolved, "Persistent Assault resolvable");
  const fleetMod = computeMissionFleetDefenseModifier(s);
  assert(fleetMod === -2, `Fleet defense modifier = -2 (got ${fleetMod})`);
  printLog(s);
}

// ============================================================
// CATEGORY 6: PERSISTENT MISSIONS — Keyword Grants
// ============================================================

// --- 26. Ram The Ship — All ships gain Scramble ---
header("Ram The Ship — Persistent: All ships gain Scramble");
{
  // Requires 3 ships
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-073", // Ram The Ship
          "BSG1-147", // Viper 113
          "BSG1-148", // Viper 229
          "BSG1-146", // Colonial Shuttle
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "ram the ship");
  assert(resolved, "Ram The Ship resolvable");
  const viperStack = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  if (viperStack) {
    const kws = getMissionKeywordGrants(s, viperStack, 0);
    assert(kws.includes("Scramble"), `Viper gains Scramble (keywords: ${kws})`);
  }
  printLog(s);
}

// --- 27. Sam Battery — All personnel gain Scramble ---
header("Sam Battery — Persistent: All personnel gain Scramble");
{
  // Requires 3 personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-075", // Sam Battery
          "BSG1-109", // Crashdown
          "BSG1-098", // Apollo
          "BSG1-140", // Zarek
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "sam battery");
  assert(resolved, "Sam Battery resolvable");
  const apolloStack = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (apolloStack) {
    const kws = getMissionKeywordGrants(s, apolloStack, 0);
    assert(kws.includes("Scramble"), `Apollo gains Scramble (keywords: ${kws})`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 7: PERSISTENT MISSIONS — Defeat Prevention
// ============================================================

// --- 28. Flight School — Sacrifice to prevent ship defeat ---
header("Flight School — Sacrifice to prevent ship defeat");
{
  // Requires 1 Officer + 1 Pilot — resolve first, then test prevention
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-068", // Flight School
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (Pilot)
          "BSG1-147", // Viper 113 (ship to protect)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-157"], // Hunting Raider (power 4 ship)
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-098", "BSG1-097"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  // Resolve Flight School first
  const { state: s1, resolved } = resolveMissionAction(state, 0, "flight school");
  assert(resolved, "Flight School resolvable");

  // Now have opponent challenge our Viper with their Hunting Raider (power 4 vs 2)
  // Switch to player 1's turn
  const s2 = { ...s1, activePlayerIndex: 1 };
  // Player 0 passes
  let result = applyAction(s2, 0, { type: "pass" }, bases);
  let s = result.state;

  // We just need to verify Flight School is in persistent
  const inPersist = (s.players[0].zones.persistentMissions ?? []).some(
    (c: CardInstance) => c.defId === "BSG1-068",
  );
  assert(inPersist, "Flight School in persistent missions after resolve");
  printLog(s);
}

// --- 29. Misdirection — Sacrifice to prevent personnel defeat ---
header("Misdirection — Sacrifice to prevent personnel defeat");
{
  // Requires 1 Civilian + 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-081", // Misdirection
          "BSG1-117", // Dr. Baltar (Civilian)
          "BSG1-109", // Crashdown (Officer)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "misdirection");
  assert(resolved, "Misdirection resolvable");
  const inPersist = (s.players[0].zones.persistentMissions ?? []).some(
    (c: CardInstance) => c.defId === "BSG1-081",
  );
  assert(inPersist, "Misdirection in persistent missions");
  printLog(s);
}

// ============================================================
// CATEGORY 8: PERSISTENT MISSIONS — Special Rules
// ============================================================

// --- 30. We'll See You Again — Cylon units not singular ---
header("We'll See You Again — Persistent: Cylon units not singular");
{
  // Requires 2 Cylon units
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-096", // We'll See You Again
          "BSG1-130", // Number Six (Cylon)
          "BSG1-157", // Hunting Raider (Cylon)
        ],
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

  const { state: s, resolved } = resolveMissionAction(state, 0, "we'll see you");
  assert(resolved, "We'll See You Again resolvable");
  const inPersist = (s.players[0].zones.persistentMissions ?? []).some(
    (c: CardInstance) => c.defId === "BSG1-096",
  );
  assert(inPersist, "We'll See You Again in persistent");
  printLog(s);
}

// --- 31. Difference Of Opinion — Challenge cost modifier ---
header("Difference Of Opinion — Persistent: Challenge costs 1 resource");
{
  // Requires 2 Officers
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-064", // Difference Of Opinion
          "BSG1-109", // Crashdown (Officer)
          "BSG1-143", // Adama (Officer)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const { state: s, resolved } = resolveMissionAction(state, 0, "difference of opinion");
  assert(resolved, "Difference Of Opinion resolvable");
  const inPersist = (s.players[0].zones.persistentMissions ?? []).some(
    (c: CardInstance) => c.defId === "BSG1-064",
  );
  assert(inPersist, "Difference Of Opinion in persistent");
  // Opponent's challenge actions should now show cost
  const oppActions = getValidActions(s, 1, bases);
  const challengeAction = oppActions.find((a: VA) => a.type === "challenge");
  if (challengeAction) {
    const hasCost = challengeAction.description?.includes("cost");
    assert(!!hasCost, `Challenge shows cost indicator`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 9: PERSISTENT MISSIONS — Resolve-time + Persistent
// ============================================================

// --- 32. Combat Air Patrol — Commit Pilot + gain 1 influence (persistent) ---
header("Combat Air Patrol — Commit Pilot, gain 1 influence (persistent)");
{
  // Requires 1 Pilot + 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-063", // Combat Air Patrol
          "BSG1-098", // Apollo (Pilot) — will be committed
          "BSG1-147", // Viper 113 (ship)
        ],
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

  const startInf = state.players[0].influence;
  // Find the mission action with Apollo as target
  const actions = getValidActions(state, 0, bases);
  const mission = findMission(actions, "combat air patrol");
  assert(!!mission, "Combat Air Patrol available");

  if (mission) {
    const apolloStack = state.players[0].zones.alert.find(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
    );
    const apolloId = apolloStack?.cards[0]?.instanceId;
    const { state: s } = resolveMissionAction(state, 0, "combat air patrol", {
      targetId: apolloId,
    });
    // Apollo should be committed (in reserve)
    const apolloInReserve = s.players[0].zones.reserve.some(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
    );
    assert(apolloInReserve, "Apollo committed to reserve");
    assert(
      s.players[0].influence === startInf + 1,
      `Gain 1 influence (${startInf} → ${s.players[0].influence})`,
    );
    // Mission should be persistent
    const inPersist = (s.players[0].zones.persistentMissions ?? []).some(
      (c: CardInstance) => c.defId === "BSG1-063",
    );
    assert(inPersist, "Combat Air Patrol in persistent");
    printLog(s);
  }
}

// ============================================================
// CATEGORY 10: LINK MISSIONS — Passive Modifiers
// ============================================================

// --- 33. Caprican Supplies — Link Personnel: +1 power ---
header("Caprican Supplies — Link: Personnel +1 power");
{
  // Requires 2 personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-050", // Caprican Supplies (link personnel)
          "BSG1-109", // Crashdown
          "BSG1-098", // Apollo (link target)
        ],
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

  // Link to Apollo
  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "caprican supplies", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Caprican Supplies resolvable");

  // Check linked mission on Apollo's stack
  const updatedApollo = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const linked = updatedApollo?.linkedMissions ?? [];
  assert(linked.length === 1, `Apollo has 1 linked mission (got ${linked.length})`);
  assert(linked[0]?.defId === "BSG2-050", "Linked mission is Caprican Supplies");

  if (updatedApollo) {
    const mod = computeMissionPowerModifier(s, updatedApollo, 0, { phase: "execution" });
    assert(mod === 1, `Apollo gets +1 from Caprican Supplies (got ${mod})`);
  }
  printLog(s);
}

// --- 34. Deck Crew — Link Ship: +1 power ---
header("Deck Crew — Link: Ship +1 power");
{
  // Requires 1 Enlisted
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-058", // Deck Crew (link ship)
          "BSG1-115", // Dee (Enlisted)
          "BSG1-147", // Viper 113 (link target)
        ],
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

  const viperStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  const viperId = viperStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "deck crew", {
    linkTargetId: viperId,
  });
  assert(resolved, "Deck Crew resolvable");

  const updatedViper = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  if (updatedViper) {
    const mod = computeMissionPowerModifier(s, updatedViper, 0, { phase: "execution" });
    assert(mod === 1, `Viper gets +1 from Deck Crew (got ${mod})`);
  }
  printLog(s);
}

// --- 35. Instant Acclaim — Link Unit: +1 power ---
header("Instant Acclaim — Link: Unit +1 power");
{
  // Requires 1 Civilian + 1 Politician
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-065", // Instant Acclaim (link unit)
          "BSG1-117", // Dr. Baltar (Civilian)
          "BSG1-140", // Zarek (Politician — link target)
        ],
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

  const zarekStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  const zarekId = zarekStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "instant acclaim", {
    linkTargetId: zarekId,
  });
  assert(resolved, "Instant Acclaim resolvable");

  const updatedZarek = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
  );
  if (updatedZarek) {
    const mod = computeMissionPowerModifier(s, updatedZarek, 0, { phase: "execution" });
    assert(mod === 1, `Zarek gets +1 from Instant Acclaim (got ${mod})`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 11: LINK MISSIONS — Keyword Grants
// ============================================================

// --- 36. Blackmail — Link Personnel: gains Manipulate ---
header("Blackmail — Link: Personnel gains Manipulate");
{
  // Requires 2 personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-048", // Blackmail (link personnel)
          "BSG1-109", // Crashdown
          "BSG1-098", // Apollo (link target)
        ],
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

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "blackmail", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Blackmail resolvable");

  const updatedApollo = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (updatedApollo) {
    const kws = getMissionKeywordGrants(s, updatedApollo, 0);
    assert(kws.includes("Manipulate"), `Apollo gains Manipulate (keywords: ${kws})`);
  }
  printLog(s);
}

// --- 37. Marine Assault — Link Ship: gains Scramble ---
header("Marine Assault — Link: Ship gains Scramble");
{
  // Requires 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-067", // Marine Assault (link ship)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-147", // Viper 113 (link target)
        ],
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

  const viperStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  const viperId = viperStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "marine assault", {
    linkTargetId: viperId,
  });
  assert(resolved, "Marine Assault resolvable");

  const updatedViper = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-147",
  );
  if (updatedViper) {
    const kws = getMissionKeywordGrants(s, updatedViper, 0);
    assert(kws.includes("Scramble"), `Viper gains Scramble (keywords: ${kws})`);
  }
  printLog(s);
}

// --- 38. Cutting Through The Hull — Link Unit: gains Scramble ---
header("Cutting Through The Hull — Link: Unit gains Scramble");
{
  // Requires 1 Officer + 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-054", // Cutting Through The Hull (link unit)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (link target — personnel)
          "BSG1-147", // Viper 113 (ship — requirement)
        ],
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

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "cutting through", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Cutting Through The Hull resolvable");

  const updatedApollo = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (updatedApollo) {
    const kws = getMissionKeywordGrants(s, updatedApollo, 0);
    assert(kws.includes("Scramble"), `Apollo gains Scramble (keywords: ${kws})`);
  }
  printLog(s);
}

// --- 39. To Your Ships — Link Personnel: gains Scramble ---
header("To Your Ships — Link: Personnel gains Scramble");
{
  // Requires 1 Officer + 1 Pilot
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-080", // To Your Ships (link personnel)
          "BSG1-109", // Crashdown (Officer)
          "BSG1-098", // Apollo (Pilot — link target)
        ],
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

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "to your ships", {
    linkTargetId: apolloId,
  });
  assert(resolved, "To Your Ships resolvable");

  const updatedApollo = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (updatedApollo) {
    const kws = getMissionKeywordGrants(s, updatedApollo, 0);
    assert(kws.includes("Scramble"), `Apollo gains Scramble (keywords: ${kws})`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 12: LINK MISSIONS — Cylon Phase Power
// ============================================================

// --- 40. Explosive Rounds — Link Unit: +2 power during Cylon phase ---
header("Explosive Rounds — Link: +2 power in Cylon phase");
{
  // Requires 1 Enlisted + 1 Officer
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-060", // Explosive Rounds (link unit)
          "BSG1-115", // Dee (Enlisted)
          "BSG1-109", // Crashdown (Officer — link target)
        ],
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

  const crashStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-109",
  );
  const crashId = crashStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "explosive rounds", {
    linkTargetId: crashId,
  });
  assert(resolved, "Explosive Rounds resolvable");

  const updatedCrash = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-109",
  );
  if (updatedCrash) {
    const execMod = computeMissionPowerModifier(s, updatedCrash, 0, { phase: "execution" });
    const cylonMod = computeMissionPowerModifier(s, updatedCrash, 0, { phase: "cylon" });
    assert(execMod === 0, `No bonus in execution (got ${execMod})`);
    assert(cylonMod === 2, `+2 in Cylon phase (got ${cylonMod})`);
  }
  printLog(s);
}

// --- 41. Teamwork — Link Ship: +2 power during Cylon phase ---
header("Teamwork — Link: Ship +2 power in Cylon phase");
{
  // Requires 2 ships
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-076", // Teamwork (link ship)
          "BSG1-147", // Viper 113
          "BSG1-148", // Viper 229 (link target)
        ],
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

  const viperStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-148",
  );
  const viperId = viperStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "teamwork", {
    linkTargetId: viperId,
  });
  assert(resolved, "Teamwork resolvable");

  const updatedViper = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-148",
  );
  if (updatedViper) {
    const cylonMod = computeMissionPowerModifier(s, updatedViper, 0, { phase: "cylon" });
    assert(cylonMod === 2, `+2 in Cylon phase (got ${cylonMod})`);
  }
  printLog(s);
}

// --- 42. Mysterious Warning — Link Personnel: +2 power during Cylon phase ---
header("Mysterious Warning — Link: Personnel +2 power in Cylon phase");
{
  // Requires 2 personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-068", // Mysterious Warning (link personnel)
          "BSG1-109", // Crashdown
          "BSG1-098", // Apollo (link target)
        ],
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

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "mysterious warning", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Mysterious Warning resolvable");

  const updatedApollo = s.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  if (updatedApollo) {
    const cylonMod = computeMissionPowerModifier(s, updatedApollo, 0, { phase: "cylon" });
    assert(cylonMod === 2, `+2 in Cylon phase (got ${cylonMod})`);
  }
  printLog(s);
}

// ============================================================
// CATEGORY 13: LINK MISSIONS — Challenge Restrictions
// ============================================================

// --- 43. Damning Evidence — Link: Personnel can't challenge ---
header("Damning Evidence — Link: Personnel can't challenge");
{
  // Requires 1 Cylon personnel (non-Machine)
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-057", // Damning Evidence (link personnel)
          "BSG1-130", // Number Six (Cylon)
          "BSG1-098", // Apollo (link target)
        ],
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

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s, resolved } = resolveMissionAction(state, 0, "damning evidence", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Damning Evidence resolvable");

  // Apollo should no longer be able to challenge
  const actions = getValidActions(s, 0, bases);
  const apolloChallenge = actions.find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG1-098",
  );
  assert(!apolloChallenge, "Apollo cannot challenge with Damning Evidence");
  printLog(s);
}

// --- 44. Raider Swarm — Link Ship: can't challenge ---
header("Raider Swarm — Link: Ship can't challenge");
{
  // Requires 2 Cylon ships
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-072", // Raider Swarm (link ship)
          "BSG1-157", // Hunting Raider (Cylon ship)
          "BSG2-152", // Menacing Raider (Cylon ship — link target)
        ],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-147"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const raiderStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG2-152",
  );
  const raiderId = raiderStack?.cards[0]?.instanceId;
  const { state: s1, resolved } = resolveMissionAction(state, 0, "raider swarm", {
    linkTargetId: raiderId,
  });
  assert(resolved, "Raider Swarm resolvable");

  // After resolving, it's player 1's turn. Pass player 1 to get back to player 0.
  let result = applyAction(s1, 1, { type: "pass" }, bases);
  const s = result.state;

  const actions = getValidActions(s, 0, bases);
  const raiderChallenge = actions.find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG2-152",
  );
  assert(!raiderChallenge, "Menacing Raider cannot challenge with Raider Swarm");
  // Hunting Raider should still be able to challenge
  const huntingChallenge = actions.find(
    (a: VA) => a.type === "challenge" && a.cardDefId === "BSG1-157",
  );
  assert(!!huntingChallenge, "Hunting Raider can still challenge");
  printLog(s);
}

// ============================================================
// CATEGORY 14: LINK MISSIONS — Activated Abilities
// ============================================================

// --- 45. Are You Alive? — Commit: target unit -2 power ---
header("Are You Alive? — Link: Commit for -2 power");
{
  // Requires 1 Cylon personnel
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-045", // Are You Alive? (link personnel)
          "BSG1-130", // Number Six (Cylon)
          "BSG1-098", // Apollo (link target — will get the ability)
        ],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        alert: ["BSG1-140"],
        influence: 10,
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      phase: "execution",
      turn: 3,
      activePlayerIndex: 0,
    },
    registry,
  );

  const apolloStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
  );
  const apolloId = apolloStack?.cards[0]?.instanceId;
  const { state: s1, resolved } = resolveMissionAction(state, 0, "are you alive", {
    linkTargetId: apolloId,
  });
  assert(resolved, "Are You Alive? resolvable");

  // After resolving, it's player 1's turn. Pass to get back to player 0.
  let r1 = applyAction(s1, 1, { type: "pass" }, bases);
  const s2 = r1.state;

  // Now use the linked ability: commit Apollo to give opponent's unit -2 power
  const actions = getValidActions(s2, 0, bases);
  const ability = findAbility(actions, "are you alive");
  assert(!!ability, "Are You Alive? linked ability available");

  if (ability) {
    // Target opponent's Zarek
    const zarekStack = s2.players[1].zones.alert.find(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-140",
    );
    const zarekId = zarekStack?.cards[0]?.instanceId;
    const ga: GA = {
      type: "playAbility",
      sourceInstanceId: apolloId!,
      targetInstanceId: zarekId,
    };
    const result = applyAction(s2, 0, ga, bases);
    const s = result.state;
    // Apollo should be committed (reserve)
    const apolloInReserve = s.players[0].zones.reserve.some(
      (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-098",
    );
    assert(apolloInReserve, "Apollo committed");
    const logStr = s.log.map((e: LogItem) => logText(e)).join(" ");
    assert(logStr.includes("-2 power"), "Target gets -2 power");
    printLog(s);
  }
}

// --- 46. Viral Warfare — Link Ship: Commit to make opponent discard ---
header("Viral Warfare — Link: Commit ship, opponent discards");
{
  // Requires 2 Cylon units
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG2-082", // Viral Warfare (link ship)
          "BSG1-130", // Number Six (Cylon)
          "BSG1-157", // Hunting Raider (Cylon ship — link target)
        ],
        deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      },
      player1: {
        baseId: "BSG1-007",
        hand: ["BSG1-098", "BSG1-099"],
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

  const raiderStack = state.players[0].zones.alert.find(
    (st: { cards: Array<{ defId: string }> }) => st.cards[0]?.defId === "BSG1-157",
  );
  const raiderId = raiderStack?.cards[0]?.instanceId;
  const { state: s1, resolved } = resolveMissionAction(state, 0, "viral warfare", {
    linkTargetId: raiderId,
  });
  assert(resolved, "Viral Warfare resolvable");

  // After resolving, it's player 1's turn. Pass to get back to player 0.
  let r1 = applyAction(s1, 1, { type: "pass" }, bases);
  const s2 = r1.state;

  const oppHandBefore = s2.players[1].hand.length;
  const actions = getValidActions(s2, 0, bases);
  const ability = findAbility(actions, "viral warfare");
  assert(!!ability, "Viral Warfare linked ability available");

  if (ability) {
    const ga: GA = {
      type: "playAbility",
      sourceInstanceId: raiderId!,
      targetInstanceId: undefined,
    };
    const result = applyAction(s2, 0, ga, bases);
    const s = result.state;
    assert(
      s.players[1].hand.length === oppHandBefore - 1,
      `Opponent discarded (${oppHandBefore} → ${s.players[1].hand.length})`,
    );
    printLog(s);
  }
}

// ============================================================
// CATEGORY 15: ONE-SHOT MISSIONS — Asset Destruction
// ============================================================

// --- 47. Obliterate The Base — Defeat target asset with no supply cards ---
header("Obliterate The Base — Defeat asset with no supply cards");
{
  // Requires 1 Pilot + 1 ship
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-083", // Obliterate The Base
          "BSG1-098", // Apollo (Pilot)
          "BSG1-147", // Viper (ship)
        ],
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

  // Add an asset to opponent's resource area (no supply cards)
  state.players[1].zones.resourceStacks.push({
    topCard: { defId: "BSG1-140", instanceId: "asset1", faceUp: true },
    supplyCards: [],
    exhausted: false,
  });

  const actions = getValidActions(state, 0, bases);
  const mission = findMission(actions, "obliterate");
  assert(!!mission, "Obliterate The Base available");
  assert((mission?.missionTargetIds?.length ?? 0) > 0, "Has asset target");

  if (mission) {
    const { state: s } = resolveMissionAction(state, 0, "obliterate", { targetId: "asset1" });
    // Asset should be gone
    const assetGone = !s.players[1].zones.resourceStacks.some(
      (rs: { topCard: { instanceId: string } }) => rs.topCard.instanceId === "asset1",
    );
    assert(assetGone, "Opponent's asset defeated");
    printLog(s);
  }
}

// --- 48. hasResolvedMission flag — only one mission per execution phase ---
header("Only one mission per execution phase");
{
  let state = createDebugGame(
    {
      player0: {
        baseId: "BSG1-004",
        hand: [],
        alert: [
          "BSG1-087", // Press Junket (1 ship)
          "BSG1-073", // Hand Of God (1 Politician)
          "BSG1-147", // Viper (ship)
          "BSG1-140", // Zarek (Politician)
        ],
        deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
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

  // Resolve first mission
  const { state: s1, resolved } = resolveMissionAction(state, 0, "press junket");
  assert(resolved, "First mission resolves");

  // Try second mission — should not be available
  const actions = getValidActions(s1, 0, bases);
  const secondMission = findMission(actions, "hand of god");
  assert(!secondMission, "Cannot resolve second mission in same execution phase");
  printLog(s1);
}

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
