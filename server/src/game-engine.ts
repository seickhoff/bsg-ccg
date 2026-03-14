import type {
  GameState,
  PlayerState,
  GameAction,
  ValidAction,
  PlayerGameView,
  CardInstance,
  ResourceStack,
  UnitStack,
  ChallengeState,
  BaseCardDef,
  CardDef,
  CardCost,
  ResourceType,
  ReadyStep,
  OpponentView,
  LogItem,
  DebugScenario,
  DebugPlayerSetup,
  CardRegistry,
} from "@bsg/shared";
import { hasKeyword } from "@bsg/shared";
import {
  canUnitChallenge,
  canUnitDefend,
  getDefenderSelector,
  getUndefendedEffect,
} from "./keyword-rules.js";
import {
  getBaseAbilityActions,
  resolveBaseAbilityEffect,
  getOnChallengedTrigger,
  interceptInfluenceLoss,
  hasColonialHeavy798,
  exhaustColonialHeavy798,
  getBaseAbilityHandler,
  setBaseAbilityCardRegistry,
  dispatchOnCylonReveal,
} from "./base-abilities.js";
import {
  getUnitAbilityActions,
  resolveUnitAbility,
  getUnitAbilityCost,
  canUnitAbilityChallenge,
  computePassivePowerBreakdown,
  computeFleetDefenseModifiers,
  computeCylonThreatBonus,
  fireOnEnterPlay,
  fireOnDefeat,
  fireOnChallengeEnd,
  fireOnMysticReveal,
  fireOnShipEnterPlay,
  fireOnChallengeInit,
  fireOnChallengeWin,
  setUnitAbilityCardRegistry,
  findAlertStarbuckReroll,
  findAlertSixSeductress,
  findReserveTighXO,
  readyUnit,
  getFreighterResource,
  getCommitOtherPowerBuff,
  canFlashDefend,
  isChallengePendingTriggerAbility,
  canInterceptInfluenceLoss,
} from "./unit-abilities.js";
import {
  resolveEventAbility,
  canPlayEvent,
  isEventPlayableIn,
  getEventTargets,
  getEventTargetPrompt,
  setEventGameHelpers,
  setEventAbilityCardRegistry,
} from "./event-abilities.js";
import {
  resolveMissionAbility,
  getMissionCategory,
  getLinkTargetType,
  computeMissionPowerBreakdown,
  computeMissionFleetDefenseModifier,
  computeMissionCylonThreatBonus,
  getMissionKeywordGrants,
  canLinkedUnitChallenge,
  getMissionActivationActions,
  resolveMissionActivation,
  fireMissionOnEventPlay,
  fireMissionOnReadyPhaseStart,
  interceptMissionDefeat,
  cleanupLinkedMissions,
  fireMissionOnCylonDefeat,
  fireMissionOnChallengeWin as fireMissionOnChallengeWinHook,
  fireMissionOnDraw,
  checkMissionOverlayPrevention,
  getMissionChallengeCost,
  hasIndependentTribunal,
  getMissionResolveTargets,
  canResolveMissionAbility,
  setMissionAbilityCardRegistry,
  setMissionGameHelpers,
} from "./mission-abilities.js";
import {
  setPendingChoiceHelpers,
  getHelpers,
  dispatchGetPendingChoiceActions,
  dispatchResolvePendingChoice,
  registerPendingChoice,
} from "./pending-choice-registry.js";
import { setCylonThreatHelpers, applyRegisteredCylonThreat } from "./cylon-threat-handlers.js";
// Card registry — populated at startup via setCardRegistry()
let cardRegistry: Record<string, CardDef> = {};

export function setCardRegistry(
  cards: Record<string, CardDef>,
  bases: Record<string, BaseCardDef>,
): void {
  cardRegistry = cards;
  setBaseAbilityCardRegistry(cards);
  setUnitAbilityCardRegistry(cards);
  setEventAbilityCardRegistry(cards);
  setMissionAbilityCardRegistry(cards);
  setMissionGameHelpers({
    getCardDef,
    cardName,
    defeatUnit,
    commitUnit,
    drawCards,
    applyPowerBuff,
    applyInfluenceLoss,
    bases,
  });
  setEventGameHelpers({
    getCardDef,
    cardName,
    defeatUnit,
    commitUnit,
    drawCards,
    applyPowerBuff,
    applyInfluenceLoss,
    revealMysticValue(state: GameState, playerIndex: number, log: LogItem[]): number {
      const player = state.players[playerIndex];
      const result = revealMysticValue(player, log, state.playerNames[playerIndex as 0 | 1]);
      return result.value;
    },
    bases,
  });
  setPendingChoiceHelpers({
    getCardDef,
    cardName,
    defeatUnit,
    commitUnit,
    readyUnit,
    drawCards,
    applyPowerBuff,
    applyInfluenceLoss,
    resumeChallenge(state, log, _bases) {
      resolveChallenge(state, log, _bases);
    },
    findUnitInZone,
    findUnitInAnyZone,
    bases,
  });

  setCylonThreatHelpers({
    getCardDef,
    commitUnit,
    findUnitInAnyZone,
    applyInfluenceLoss,
    bases,
  });
}

// ============================================================
// BSG CCG — Game Engine
// Server-authoritative state machine for the card game.
// ============================================================

let instanceCounter = 0;
function makeInstanceId(): string {
  return `card-${++instanceCounter}`;
}

function makeCardInstance(defId: string): CardInstance {
  return { instanceId: makeInstanceId(), defId, faceUp: true };
}

/** Fisher-Yates (Knuth) shuffle — in-place, O(n). */
function shuffle<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export function getCardDef(defId: string): CardDef {
  const def = cardRegistry[defId];
  if (!def) throw new Error(`Unknown card def: ${defId}`);
  return def;
}

function isUnit(def: CardDef): boolean {
  return def.type === "personnel" || def.type === "ship";
}

function isMission(def: CardDef): boolean {
  return def.type === "mission";
}

/** A singular card has both title and subtitle (per rules, only personnel). */
function isSingular(def: CardDef): boolean {
  return !!def.title && !!def.subtitle;
}

function cardName(def: CardDef): string {
  if (def.title && def.subtitle) return `${def.title}, ${def.subtitle}`;
  return def.title ?? def.subtitle ?? "?";
}

/** Get player display name from state. */
function pName(s: GameState, index: number): string {
  return s.playerNames[index as 0 | 1] ?? `Player ${index + 1}`;
}

/**
 * Find an existing unit stack whose top card shares the same title as the given def.
 * Searches alert first, then reserve (per rules, overlay keeps the stack's current zone).
 */
function findOverlayTarget(
  player: PlayerState,
  def: CardDef,
): { stack: UnitStack; zone: "alert" | "reserve" } | null {
  if (!def.title) return null;
  for (const stack of player.zones.alert) {
    const topDef = getCardDef(stack.cards[0].defId);
    if (topDef.title === def.title) return { stack, zone: "alert" };
  }
  for (const stack of player.zones.reserve) {
    const topDef = getCardDef(stack.cards[0].defId);
    if (topDef.title === def.title) return { stack, zone: "reserve" };
  }
  return null;
}

// --- Compute Cylon threat level from face-up alert + reserve cards ---

function computeCylonThreatLevel(state: GameState): number {
  let total = 0;
  for (const player of state.players) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        const topCard = stack.cards[0];
        if (topCard && topCard.faceUp) {
          let threat = getCardDef(topCard.defId).cylonThreat ?? 0;
          // Apply Gaeta Brilliant temporary Cylon threat mods
          const mod = player.temporaryCylonThreatMods?.[topCard.instanceId];
          if (mod) threat = Math.max(0, threat + mod);
          total += threat;
        }
      }
    }
  }
  return total;
}

// --- Determine first player (lowest influence, tie = previous stays) ---

function determineFirstPlayer(state: GameState): number {
  const inf0 = state.players[0].influence;
  const inf1 = state.players[1].influence;
  if (inf0 < inf1) return 0;
  if (inf1 < inf0) return 1;
  return state.firstPlayerIndex; // tie: previous first player stays
}

// --- Deep clone helper ---

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

// --- Draw cards from deck (handles reshuffle) ---

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
      if (player.discard.length === 0) {
        log.push(`${playerLabel} has no cards to draw.`);
        return;
      }
      // Reshuffle discard into deck
      player.deck = [...player.discard];
      player.discard = [];
      shuffle(player.deck);
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

// --- Reveal mystic value (flip top of deck) ---

function revealTopCard(player: PlayerState, log: LogItem[], playerLabel: string): CardInstance {
  if (player.deck.length === 0) {
    if (player.discard.length === 0) {
      // Both deck and discard empty — use Condition One as a dummy reveal
      return makeCardInstance("BSG1-015");
    }
    player.deck = [...player.discard];
    player.discard = [];
    shuffle(player.deck);
    log.push(`${playerLabel} reshuffled discard pile into deck.`);
  }
  const card = player.deck.shift()!;
  player.discard.push(card);
  return card;
}

function revealMysticValue(
  player: PlayerState,
  log: LogItem[],
  playerLabel: string,
): { value: number; card: CardInstance } {
  const card = revealTopCard(player, log, playerLabel);
  const def = getCardDef(card.defId);
  log.push(`${playerLabel} reveals ${cardName(def)} (mystic value ${def.mysticValue ?? 0}).`);
  return { value: def.mysticValue ?? 0, card };
}

// --- Count resources a stack generates ---

function stackResourceCount(stack: ResourceStack): number {
  return 1 + stack.supplyCards.length;
}

// --- Get resource type from stack ---

function getStackResourceType(
  stack: ResourceStack,
  bases: Record<string, BaseCardDef>,
): string | null {
  const defId = stack.topCard.defId;
  // Check if it's a base
  const base = bases[defId];
  if (base) return base.resource;
  // Otherwise it's a card def used as asset
  const cardDef = cardRegistry[defId];
  return cardDef?.resource ?? null;
}

// --- Find unit stack by instance ID in a zone ---

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

// --- Power breakdown logging ---

function logPowerBreakdown(
  log: LogItem[],
  label: string,
  stack: UnitStack,
  challengeBuff: number,
  state: GameState,
  ownerIndex: number,
  context: {
    phase?: string;
    isChallenger?: boolean;
    isDefender?: boolean;
    challengerDef?: CardDef;
    defenderDef?: CardDef;
  },
  opts?: { extraBuff?: number; extraLabel?: string; mystic?: number },
): number {
  const topCard = stack.cards[0];
  const def = topCard ? getCardDef(topCard.defId) : null;
  const basePower = def?.power ?? 0;
  const stackBuff = stack.powerBuff ?? 0;

  const passiveItems = computePassivePowerBreakdown(state, stack, ownerIndex, context);
  const missionItems = computeMissionPowerBreakdown(state, stack, ownerIndex, context);
  const passiveTotal = passiveItems.reduce((s, i) => s + i.amount, 0);
  const missionTotal = missionItems.reduce((s, i) => s + i.amount, 0);
  const unitPower =
    basePower + stackBuff + challengeBuff + passiveTotal + missionTotal + (opts?.extraBuff ?? 0);

  // Build breakdown parts
  const parts: string[] = [`base ${basePower}`];
  if (stackBuff) parts.push(`buff ${stackBuff > 0 ? "+" : ""}${stackBuff}`);
  if (challengeBuff) parts.push(`challenge ${challengeBuff > 0 ? "+" : ""}${challengeBuff}`);
  for (const p of passiveItems) parts.push(`${p.source} ${p.amount > 0 ? "+" : ""}${p.amount}`);
  for (const m of missionItems) parts.push(`${m.source} ${m.amount > 0 ? "+" : ""}${m.amount}`);
  if (opts?.extraBuff)
    parts.push(`${opts.extraLabel ?? "extra"} ${opts.extraBuff > 0 ? "+" : ""}${opts.extraBuff}`);

  const unitName = def ? cardName(def) : "?";
  log.push({
    msg: `${label} ${unitName}: power ${unitPower} (${parts.join(", ")})`,
    d: 2,
    cat: "power",
  });

  if (opts?.mystic !== undefined) {
    const total = unitPower + opts.mystic;
    log.push({
      msg: `${label} total: ${total} (power ${unitPower} + mystic ${opts.mystic})`,
      d: 2,
      cat: "power",
    });
    return total;
  }
  return unitPower;
}

// ============================================================
// Timestamped Log
// ============================================================

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `[${h}:${m}:${s}]`;
}

function stampLog(entries: LogItem[]): LogItem[] {
  const ts = timestamp();
  return entries.map((e) =>
    typeof e === "string" ? `${ts} ${e}` : { ...e, msg: `${ts} ${e.msg}` },
  );
}

// ============================================================
// Create Game
// ============================================================

export function createGame(
  base1: BaseCardDef,
  deck1: string[],
  base2: BaseCardDef,
  deck2: string[],
  playerNames?: [string, string],
): GameState {
  instanceCounter = 0;

  const makePlayer = (base: BaseCardDef, deckDefIds: string[]): PlayerState => {
    const baseInstance = makeCardInstance(base.id);
    const deckInstances = deckDefIds.map((defId) => makeCardInstance(defId));
    return {
      baseDefId: base.id,
      zones: {
        alert: [],
        reserve: [],
        resourceStacks: [{ topCard: baseInstance, supplyCards: [], exhausted: false }],
      },
      hand: [],
      deck: deckInstances,
      discard: [],
      influence: base.startingInfluence,
      hasMulliganed: false,
      hasPlayedResource: false,
      hasResolvedMission: false,
      consecutivePasses: 0,
    };
  };

  const p1 = makePlayer(base1, deck1);
  const p2 = makePlayer(base2, deck2);
  const fleetDefenseLevel = base1.power + base2.power;

  // Shuffle each player's deck before play
  shuffle(p1.deck);
  shuffle(p2.deck);

  const names = playerNames ?? ["Player 1", "Player 2"];

  // Draw starting hands
  const log: LogItem[] = [];
  drawCards(p1, base1.handSize, log, names[0]);
  drawCards(p2, base2.handSize, log, names[1]);
  log.push("Game created. Players may choose to keep or redraw their hands.");

  const state: GameState = {
    players: [p1, p2],
    playerNames: names,
    phase: "setup",
    turn: 0,
    readyStep: 1 as ReadyStep,
    firstPlayerIndex: p1.influence <= p2.influence ? 0 : 1,
    activePlayerIndex: p1.influence <= p2.influence ? 0 : 1,
    fleetDefenseLevel,
    challenge: null,
    cylonThreats: [],
    log: stampLog(log),
    winner: null,
  };

  return state;
}

// ============================================================
// Debug / Test Scenario Setup
// ============================================================

export function createDebugGame(
  scenario: DebugScenario,
  registry: CardRegistry,
  playerNames?: [string, string],
): GameState {
  instanceCounter = 0;

  const makeDebugPlayer = (setup: DebugPlayerSetup, fallbackDeckIds: string[]): PlayerState => {
    const baseDef = registry.bases[setup.baseId];
    if (!baseDef) throw new Error(`Unknown base: ${setup.baseId}`);

    const baseInstance = makeCardInstance(baseDef.id);

    const hand = (setup.hand ?? []).map((id: string) => makeCardInstance(id));
    const alert: UnitStack[] = (setup.alert ?? []).map((id: string) => ({
      cards: [makeCardInstance(id)],
      exhausted: false,
    }));
    const reserve: UnitStack[] = (setup.reserve ?? []).map((id: string) => ({
      cards: [makeCardInstance(id)],
      exhausted: false,
    }));

    // Deck: use provided list, or fall back to generated deck minus cards already placed
    const placedIds = [...(setup.hand ?? []), ...(setup.alert ?? []), ...(setup.reserve ?? [])];
    let deckDefIds: string[];
    if (setup.deck) {
      deckDefIds = setup.deck;
    } else {
      // Remove placed cards from fallback deck (remove first occurrence of each)
      deckDefIds = [...fallbackDeckIds];
      for (const id of placedIds) {
        const idx = deckDefIds.indexOf(id);
        if (idx !== -1) deckDefIds.splice(idx, 1);
      }
    }
    const deck = deckDefIds.map((id: string) => makeCardInstance(id));

    return {
      baseDefId: baseDef.id,
      zones: {
        alert,
        reserve,
        resourceStacks: [
          {
            topCard: baseInstance,
            supplyCards: Array.from({ length: setup.baseSupplyCards ?? 0 }, () =>
              makeCardInstance(setup.baseId),
            ),
            exhausted: false,
          },
          ...(setup.assets ?? []).map((id: string) => ({
            topCard: makeCardInstance(id),
            supplyCards: [] as CardInstance[],
            exhausted: false,
          })),
        ],
      },
      hand,
      deck,
      discard: [],
      influence: setup.influence ?? baseDef.startingInfluence,
      hasMulliganed: true,
      hasPlayedResource: false,
      hasResolvedMission: false,
      consecutivePasses: 0,
    };
  };

  // Build fallback decks from all cards in registry (simple pool)
  const allCardIds = Object.keys(registry.cards);
  const p0 = makeDebugPlayer(scenario.player0, allCardIds);
  const p1 = makeDebugPlayer(scenario.player1, allCardIds);

  const base0 = registry.bases[scenario.player0.baseId];
  const base1 = registry.bases[scenario.player1.baseId];
  const fleetDefenseLevel = base0.power + base1.power;

  const phase = scenario.phase ?? "execution";
  const turn = scenario.turn ?? 3;
  const activePlayerIndex = scenario.activePlayerIndex ?? 0;
  const firstPlayerIndex = activePlayerIndex;

  const log: LogItem[] = [];
  log.push(`[DEBUG] Scenario loaded — phase: ${phase}, turn: ${turn}`);

  const state: GameState = {
    players: [p0, p1],
    playerNames: playerNames ?? ["Player 1", "Player 2"],
    phase,
    turn,
    readyStep: 1 as ReadyStep,
    firstPlayerIndex,
    activePlayerIndex,
    fleetDefenseLevel,
    challenge: null,
    cylonThreats: [],
    log: stampLog(log),
    winner: null,
  };

  // If starting in cylon phase, run the phase setup to reveal threats
  if (phase === "cylon") {
    const bases = registry.bases;
    startCylonPhase(state, state.log, bases);
  }

  return state;
}

// ============================================================
// Get Player View
// ============================================================

export function getPlayerView(state: GameState, playerIndex: number): PlayerGameView {
  const you = state.players[playerIndex];
  const opp = state.players[1 - playerIndex];

  const oppView: OpponentView = {
    zones: opp.zones,
    handCount: opp.hand.length,
    deckCount: opp.deck.length,
    discardCount: opp.discard.length,
    discard: opp.discard,
    influence: opp.influence,
  };

  return {
    you: {
      playerIndex,
      zones: you.zones,
      hand: you.hand,
      deckCount: you.deck.length,
      discardCount: you.discard.length,
      discard: you.discard,
      influence: you.influence,
    },
    opponent: oppView,
    playerNames: state.playerNames,
    phase: state.phase,
    turn: state.turn,
    readyStep: state.readyStep,
    firstPlayerIndex: state.firstPlayerIndex,
    activePlayerIndex: state.activePlayerIndex,
    fleetDefenseLevel: state.fleetDefenseLevel,
    challenge: state.challenge,
    cylonThreats: state.cylonThreats,
    log: state.log,
    winner: state.winner,
    traitGrants: { ...you.temporaryTraitGrants, ...opp.temporaryTraitGrants },
    choicePrompt: state.pendingChoice?.prompt,
    choiceType: state.pendingChoice?.type,
  };
}

// ============================================================
// Get Valid Actions
// ============================================================

export function getValidActions(
  state: GameState,
  playerIndex: number,
  bases: Record<string, BaseCardDef>,
): ValidAction[] {
  const actions: ValidAction[] = [];
  const player = state.players[playerIndex];
  const isActive = state.activePlayerIndex === playerIndex;

  // --- Setup phase: mulligan ---
  if (state.phase === "setup") {
    if (!player.hasMulliganed && player.hand.length > 0) {
      actions.push({ type: "keepHand", description: "Keep your hand" });
      actions.push({ type: "redraw", description: "Redraw your hand" });
    }
    return actions;
  }

  // --- Game over ---
  if (state.phase === "gameOver") return actions;

  // --- Pending choice (e.g. Celestra deck manipulation) ---
  if (state.pendingChoice) {
    if (playerIndex === state.pendingChoice.playerIndex) {
      return getPendingChoiceActions(state);
    }
    return actions; // other player waits
  }

  // --- Challenge sub-state ---
  if (state.challenge) {
    return getChallengeActions(state, playerIndex, bases);
  }

  // --- Ready phase ---
  if (state.phase === "ready" && state.readyStep === 3 && isActive) {
    actions.push({ type: "drawCards", description: "Draw 2 Cards" });
    return actions;
  }

  if (state.phase === "ready" && state.readyStep === 4 && isActive) {
    if (!player.hasPlayedResource) {
      const stackIndices = player.zones.resourceStacks.map((_: ResourceStack, i: number) => i);
      for (let i = 0; i < player.hand.length; i++) {
        const def = getCardDef(player.hand[i].defId);
        actions.push({
          type: "playToResource",
          description: cardName(def),
          cardDefId: def.id,
          selectableCardIndices: [i],
          selectableStackIndices: stackIndices,
        });
      }
      actions.push({ type: "passResource", description: "Pass" });
    }
    return actions;
  }

  if (state.phase === "ready" && state.readyStep === 5 && isActive) {
    // Offer reorder actions for stacks with 2+ cards
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        if (stack.cards.length >= 2) {
          const topDef = getCardDef(stack.cards[0].defId);
          for (let ci = 1; ci < stack.cards.length; ci++) {
            const altDef = getCardDef(stack.cards[ci].defId);
            actions.push({
              type: "reorderStack" as GameAction["type"],
              description: `Reorder: ${cardName(altDef)} to top (currently ${cardName(topDef)})`,
              cardDefId: altDef.id,
              selectableInstanceIds: [stack.cards[0].instanceId],
            });
          }
        }
      }
    }
    actions.push({ type: "doneReorder", description: "Done reordering stacks" });
    return actions;
  }

  // --- Execution phase ---
  if (state.phase === "execution" && isActive) {
    // Play a card from hand (affordable = active, unaffordable = disabled)
    for (let i = 0; i < player.hand.length; i++) {
      const def = getCardDef(player.hand[i].defId);
      const affordable = canAfford(player, def, bases);
      // Targeted events with no valid targets are not playable
      if (
        def.type === "event" &&
        def.abilityId &&
        !canPlayEvent(def.abilityId, state, playerIndex, "execution")
      ) {
        continue;
      }
      const eventAction: ValidAction = {
        type: "playCard",
        description: cardName(def),
        cardDefId: def.id,
        selectableCardIndices: [i],
        ...(affordable ? {} : { disabled: true }),
      };
      // Attach valid targets for targeted events
      if (def.type === "event" && def.abilityId) {
        const targets = getEventTargets(def.abilityId, state, playerIndex, "execution");
        if (targets) {
          eventAction.selectableInstanceIds = targets;
          const prompt = getEventTargetPrompt(def.abilityId);
          if (prompt) eventAction.targetPrompt = prompt;
        }
      }
      actions.push(eventAction);
    }

    // Play ability (base exhaust abilities via registry)
    const baseDef = bases[player.baseDefId];
    if (baseDef?.abilityId) {
      actions.push(
        ...getBaseAbilityActions(baseDef.abilityId, state, playerIndex, bases, "execution"),
      );
    }
    // Unit abilities (via registry)
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        const def = getCardDef(topCard.defId);
        if (def.abilityId) {
          actions.push(
            ...getUnitAbilityActions(
              def.abilityId,
              state,
              playerIndex,
              topCard.instanceId,
              "execution",
            ),
          );
        }
      }
    }

    // Mission activated abilities (persistent + link)
    actions.push(...getMissionActivationActions(state, playerIndex, "execution"));

    // Sacrifice from unit stack: sacrifice non-top card for +1 power
    for (const stack of player.zones.alert) {
      if (stack.cards.length >= 2 && stack.cards[0]?.faceUp) {
        const topDef = getCardDef(stack.cards[0].defId);
        for (let ci = 1; ci < stack.cards.length; ci++) {
          const sacrificeDef = getCardDef(stack.cards[ci].defId);
          actions.push({
            type: "sacrificeFromStack",
            description: `Sacrifice ${cardName(sacrificeDef)} from ${cardName(topDef)} stack (+1 power)`,
            cardDefId: sacrificeDef.id,
            selectableInstanceIds: [stack.cards[0].instanceId],
          });
        }
      }
    }

    // Challenge with an alert unit (Showdown: no challenges rest of phase)
    if (!state.noChallenges) {
      const challengeUnits: string[] = [];
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.faceUp && !stack.exhausted) {
          const def = getCardDef(topCard.defId);
          if (
            isUnit(def) &&
            canUnitChallenge(def) &&
            (!def.abilityId || canUnitAbilityChallenge(def.abilityId)) &&
            canLinkedUnitChallenge(state, stack)
          ) {
            challengeUnits.push(topCard.instanceId);
          }
        }
      }
      if (challengeUnits.length > 0) {
        const challengeCost = getMissionChallengeCost(state, playerIndex, 1 - playerIndex);
        const availableStacks =
          player.zones.resourceStacks.filter((s: ResourceStack) => !s.exhausted).length +
          countAllFreighters(player);
        const cantAfford = challengeCost > 0 && availableStacks < challengeCost;
        const costSuffix = challengeCost > 0 ? ` (costs ${challengeCost} resource)` : "";
        for (const unitId of challengeUnits) {
          const unitDef = findCardDefByInstanceId(state, unitId);
          const unitLabel = unitDef ? cardName(unitDef) : "unit";
          actions.push({
            type: "challenge",
            description: `${unitLabel}${costSuffix}`,
            cardDefId: unitDef?.id,
            selectableInstanceIds: [unitId],
            ...(cantAfford ? { disabled: true } : {}),
          });
        }
      }
    }

    // Resolve a mission
    if (!player.hasResolvedMission) {
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.faceUp) {
          const def = getCardDef(topCard.defId);
          if (isMission(def)) {
            // Check if mission requirements are met
            if (canResolveMission(player, def, bases)) {
              const missionAction: ValidAction = {
                type: "resolveMission",
                description: `Resolve ${cardName(def)}: ${def.abilityText}`,
                cardDefId: def.id,
                selectableInstanceIds: [topCard.instanceId],
              };

              // Check for resolve-time targets
              if (def.abilityId) {
                if (!canResolveMissionAbility(def.abilityId, state, playerIndex)) continue;
                const resolveTargets = getMissionResolveTargets(def.abilityId, state, playerIndex);
                if (resolveTargets !== null) {
                  if (resolveTargets.length === 0) continue; // no valid targets, can't resolve
                  missionAction.missionTargetIds = resolveTargets;
                }

                // Check for link targets
                const category = getMissionCategory(def.abilityId);
                if (category === "link") {
                  const linkType = getLinkTargetType(def.abilityId);
                  const linkTargets = getValidLinkTargets(player, linkType);
                  if (linkTargets.length === 0) continue; // no valid link target
                  if (linkTargets.length > 1) {
                    missionAction.linkTargetIds = linkTargets;
                  }
                  // if exactly 1, auto-attach (no UI needed)
                }
              }

              actions.push(missionAction);
            }
          }
        }
      }
    }

    // Pass
    actions.push({ type: "pass", description: "Pass" });
    return actions;
  }

  // --- Cylon phase ---
  if (state.phase === "cylon" && isActive && state.cylonThreats.length > 0) {
    // Challenge a Cylon threat with an alert unit
    const units: string[] = [];
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp && !stack.exhausted) {
        const def = getCardDef(topCard.defId);
        if (
          isUnit(def) &&
          canUnitChallenge(def) &&
          (!def.abilityId || canUnitAbilityChallenge(def.abilityId)) &&
          canLinkedUnitChallenge(state, stack)
        ) {
          units.push(topCard.instanceId);
        }
      }
    }
    if (units.length > 0) {
      actions.push({
        type: "challengeCylon",
        description: "Send a unit to fight",
        selectableInstanceIds: units,
        selectableThreatIndices: state.cylonThreats.map((_, i) => i),
      });
    }
    actions.push({ type: "passCylon", description: "Stand down (\u22121 influence)" });
    return actions;
  }

  return actions;
}

// --- Challenge sub-actions ---

function getChallengeActions(
  state: GameState,
  playerIndex: number,
  bases: Record<string, BaseCardDef>,
): ValidAction[] {
  const actions: ValidAction[] = [];
  const challenge = state.challenge!;
  const player = state.players[playerIndex];

  // Pending triggered ability (Agro Ship / Flattop / Tigh XO) — before defender selection
  if (challenge.pendingTrigger) {
    if (playerIndex === challenge.pendingTrigger.playerIndex) {
      if (isChallengePendingTriggerAbility(challenge.pendingTrigger.abilityId)) {
        // Tigh XO: offer to ready from reserve
        const sourceId = challenge.pendingTrigger.sourceInstanceId!;
        const tighDef = findCardDefByInstanceId(state, sourceId);
        actions.push({
          type: "useTriggeredAbility",
          description: `Ready ${tighDef ? cardName(tighDef) : "Saul Tigh"}`,
          cardDefId: tighDef?.id ?? "",
          targetInstanceId: sourceId,
        });
      } else {
        // Base trigger (Agro Ship / Flattop)
        const baseDef = bases[player.baseDefId];
        const trigger = getOnChallengedTrigger(state, playerIndex, bases);
        if (trigger) {
          for (const targetId of trigger.targets) {
            const targetDef = findCardDefByInstanceId(state, targetId);
            const targetLabel = targetDef ? cardName(targetDef) : "unit";
            actions.push({
              type: "useTriggeredAbility",
              description: `${baseDef.title}: Ready ${targetLabel}`,
              cardDefId: baseDef.id,
              targetInstanceId: targetId,
            });
          }
        }
      }
      actions.push({ type: "declineTrigger", description: "Decline" });
      return actions;
    }
    return actions; // other player waits
  }

  // Waiting for defender choice
  if (challenge.waitingForDefender) {
    const isSniper = challenge.defenderSelector === "challenger";

    // Sniper two-step flow:
    //   Step A: defending player decides accept/decline (sniperDefendAccepted not yet set)
    //   Step B: challenger picks which unit defends (sniperDefendAccepted === true)
    // Normal flow: defending player picks unit or declines.

    if (isSniper && !challenge.sniperDefendAccepted) {
      // Step A: defending player decides whether to accept defense
      if (playerIndex === challenge.defenderPlayerIndex) {
        actions.push({ type: "sniperAccept", description: "Accept defense (opponent picks unit)" });
        actions.push({ type: "sniperAccept", description: "Decline to defend" });
        return actions;
      }
      return actions; // challenger waits
    }

    // Either normal flow (defending player picks) or Sniper step B (challenger picks unit)
    const selectorPlayerIndex = isSniper
      ? challenge.challengerPlayerIndex
      : challenge.defenderPlayerIndex;

    if (playerIndex === selectorPlayerIndex) {
      const challengerDef = findCardDefByInstanceId(state, challenge.challengerInstanceId);
      if (challengerDef) {
        // Always search the DEFENDING player's board for eligible units
        const defendingPlayer = state.players[challenge.defenderPlayerIndex];
        for (const stack of defendingPlayer.zones.alert) {
          const topCard = stack.cards[0];
          if (topCard && topCard.faceUp && !stack.exhausted) {
            const def = getCardDef(topCard.defId);
            // Check mission-granted keywords (Scramble allows cross-type defense)
            const challengerStack = findUnitInAnyZone(
              state.players[challenge.challengerPlayerIndex],
              challenge.challengerInstanceId,
            );
            const missionKws = getMissionKeywordGrants(state, stack, challenge.defenderPlayerIndex);
            const hasScrambleFromMission = missionKws.includes("Scramble" as any);
            const canDefend =
              canUnitDefend(def, challengerDef) || (hasScrambleFromMission && isUnit(def));
            // Independent Tribunal: units power ≤2 can't defend against this challenger
            const tribunalBlock =
              challengerStack &&
              hasIndependentTribunal(challengerStack.stack) &&
              (def.power ?? 0) <= 2;
            if (
              isUnit(def) &&
              canDefend &&
              !(state.politiciansCantDefend && def.traits?.includes("Politician")) &&
              !tribunalBlock
            ) {
              const label = isSniper
                ? `Choose defender: ${cardName(def)}`
                : `Defend with ${cardName(def)}`;
              actions.push({
                type: "defend",
                description: label,
                cardDefId: def.id,
                selectableInstanceIds: [topCard.instanceId],
              });
            }
          }
        }
      }
      // Raptor 432: flash play from hand to defend against a ship challenger
      if (challengerDef?.type === "ship" && playerIndex === challenge.defenderPlayerIndex) {
        for (let i = 0; i < player.hand.length; i++) {
          const handDef = getCardDef(player.hand[i].defId);
          if (
            handDef.abilityId &&
            canFlashDefend(handDef.abilityId) &&
            canAfford(player, handDef, bases)
          ) {
            actions.push({
              type: "defend",
              description: `Flash play ${cardName(handDef)} from hand to defend`,
              cardDefId: handDef.id,
              selectableCardIndices: [i],
              selectableInstanceIds: [player.hand[i].instanceId],
            });
          }
        }
      }

      // In Sniper step B, challenger must pick a unit (no decline option — defender already accepted)
      if (!isSniper) {
        actions.push({ type: "defend", description: "Decline to defend" });
      }
      return actions;
    }
    return actions;
  }

  // Step 2: play effects round
  if (challenge.step === 2 && state.activePlayerIndex === playerIndex) {
    // Can play events from hand
    for (let i = 0; i < player.hand.length; i++) {
      const def = getCardDef(player.hand[i].defId);
      const challengeContext = challenge.isCylonChallenge ? "cylon-challenge" : "challenge";
      if (
        def.type === "event" &&
        canAfford(player, def, bases) &&
        (!def.abilityId || isEventPlayableIn(def.abilityId, challengeContext)) &&
        (!def.abilityId || canPlayEvent(def.abilityId, state, playerIndex, challengeContext))
      ) {
        const challengeEventAction: ValidAction = {
          type: "playEventInChallenge",
          description: `${cardName(def)} — Event`,
          cardDefId: def.id,
          selectableCardIndices: [i],
        };
        // Attach valid targets for targeted events
        if (def.abilityId) {
          const targets = getEventTargets(def.abilityId, state, playerIndex, challengeContext);
          if (targets) {
            challengeEventAction.selectableInstanceIds = targets;
            const prompt = getEventTargetPrompt(def.abilityId);
            if (prompt) challengeEventAction.targetPrompt = prompt;
          }
        }
        actions.push(challengeEventAction);
      }
    }

    // Can play abilities (unit abilities via registry)
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        const def = getCardDef(topCard.defId);
        if (def.abilityId) {
          const context = challenge.isCylonChallenge ? "cylon-challenge" : "challenge";
          actions.push(
            ...getUnitAbilityActions(
              def.abilityId,
              state,
              playerIndex,
              topCard.instanceId,
              context,
            ),
          );
        }
      }
    }

    // Sacrifice from unit stack during challenge: +1 power
    for (const stack of player.zones.alert) {
      if (stack.cards.length >= 2 && stack.cards[0]?.faceUp) {
        const topDef = getCardDef(stack.cards[0].defId);
        for (let ci = 1; ci < stack.cards.length; ci++) {
          const sacrificeDef = getCardDef(stack.cards[ci].defId);
          actions.push({
            type: "sacrificeFromStack",
            description: `Sacrifice ${cardName(sacrificeDef)} from ${cardName(topDef)} stack (+1 power)`,
            cardDefId: sacrificeDef.id,
            selectableInstanceIds: [stack.cards[0].instanceId],
          });
        }
      }
    }

    // Base exhaust abilities usable during challenges
    const baseDef = bases[player.baseDefId];
    if (baseDef?.abilityId) {
      const context = challenge.isCylonChallenge ? "cylon-challenge" : "challenge";
      actions.push(...getBaseAbilityActions(baseDef.abilityId, state, playerIndex, bases, context));
    }

    // Mission activated abilities (persistent + link) usable during challenges
    const missionContext = challenge.isCylonChallenge ? "cylon-challenge" : "challenge";
    actions.push(...getMissionActivationActions(state, playerIndex, missionContext));

    actions.push({ type: "challengePass", description: "Pass" });
    return actions;
  }

  return actions;
}

// --- Helpers ---

function findCardDefByInstanceId(state: GameState, instanceId: string): CardDef | null {
  for (const player of state.players) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        for (const card of stack.cards) {
          if (card.instanceId === instanceId) {
            return getCardDef(card.defId);
          }
        }
      }
    }
  }
  return null;
}

function canAfford(player: PlayerState, def: CardDef, bases: Record<string, BaseCardDef>): boolean {
  if (!def.cost) return true;

  // Ragnar Anchorage override: if any single logistics stack generates ≥2,
  // treat it as 3 of any one resource type
  if (player.ragnarResourceOverride) {
    // Find best logistics stack
    let bestLogistics = 0;
    for (const stack of player.zones.resourceStacks) {
      if (stack.exhausted) continue;
      if (getStackResourceTypeFromPlayer(stack, bases, player) === "logistics") {
        bestLogistics = Math.max(bestLogistics, stackResourceCount(stack));
      }
    }
    if (bestLogistics >= 2) {
      // Check if the total cost is ≤ 3 of a single type (can be paid by override)
      const costEntries = Object.entries(def.cost) as [ResourceType, number][];
      if (costEntries.length === 1 && costEntries[0][1] <= 3) {
        return true; // Ragnar can cover any single-type cost ≤ 3
      }
    }
  }

  for (const [resType, amount] of Object.entries(def.cost) as [ResourceType, number][]) {
    // Apply cost reduction (Refinery Ship)
    const reduction = player.costReduction?.[resType as keyof typeof player.costReduction] ?? 0;
    const effectiveAmount = Math.max(0, amount - reduction);
    if (effectiveAmount === 0) continue;
    let available = 0;
    for (const stack of player.zones.resourceStacks) {
      if (stack.exhausted) continue;
      if (getStackResourceTypeFromPlayer(stack, bases, player) === resType) {
        available += stackResourceCount(stack);
      }
    }
    // Count alert freighters that generate this resource type,
    // but only if at least one resource stack can still be spent
    // (freighters trigger "each time you spend a resource stack")
    if (available < effectiveAmount) {
      const anyStackCanBeSpent = player.zones.resourceStacks.some((s) => !s.exhausted);
      if (anyStackCanBeSpent) {
        available += countFreighterBonus(player, resType as ResourceType);
      }
    }
    if (available < effectiveAmount) return false;
  }
  return true;
}

function getStackResourceTypeFromPlayer(
  stack: ResourceStack,
  bases: Record<string, BaseCardDef>,
  player: PlayerState,
): string | null {
  const defId = stack.topCard.defId;
  const base = bases[defId];
  if (base) return base.resource;
  const cardDef = cardRegistry[defId];
  return cardDef?.resource ?? null;
}

/** Parsed mission requirement: count + filter function. */
interface MissionRequirement {
  count: number;
  label: string;
  matches: (def: CardDef) => boolean;
}

/**
 * Parse mission resolveText into structured requirements.
 * Handles: "Resolve: 1 Officer.", "Resolve: 1 Civilian unit and 1 Politician.", etc.
 */
function parseMissionRequirements(missionDef: CardDef): MissionRequirement[] {
  const resolveText = missionDef.resolveText ?? "";
  const resolveMatch = resolveText.match(/Resolve:\s*(.+)/);
  if (!resolveMatch) return [];

  const requirementStr = resolveMatch[1].replace(/\.$/, "");
  const parts = requirementStr.split(/\s+and\s+/);
  const requirements: MissionRequirement[] = [];

  for (const part of parts) {
    const match = part.trim().match(/^(\d+)\s+(.+?)s?$/);
    if (!match) continue;
    const count = parseInt(match[1]);
    const desc = match[2].trim();
    const descLower = desc.toLowerCase();

    let matchFn: (def: CardDef) => boolean;

    // Order matters — check compound descriptors first
    if (descLower === "cylon unit" || descLower === "cylon units") {
      matchFn = (d) =>
        (d.type === "personnel" || d.type === "ship") && (d.traits?.includes("Cylon") ?? false);
    } else if (descLower === "cylon personnel") {
      matchFn = (d) => d.type === "personnel" && (d.traits?.includes("Cylon") ?? false);
    } else if (descLower === "cylon ship" || descLower === "cylon ships") {
      matchFn = (d) => d.type === "ship" && (d.traits?.includes("Cylon") ?? false);
    } else if (descLower === "civilian unit" || descLower === "civilian units") {
      matchFn = (d) =>
        (d.type === "personnel" || d.type === "ship") && (d.traits?.includes("Civilian") ?? false);
    } else if (descLower === "ship" || descLower === "ships") {
      matchFn = (d) => d.type === "ship";
    } else if (descLower === "personnel") {
      matchFn = (d) => d.type === "personnel";
    } else if (descLower === "unit" || descLower === "units") {
      matchFn = (d) => d.type === "personnel" || d.type === "ship";
    } else {
      // Trait-based: Officer, Pilot, Politician, Civilian, Enlisted, Fighter, etc.
      const traitName = desc.charAt(0).toUpperCase() + desc.slice(1).replace(/s$/, "");
      matchFn = (d) =>
        (d.type === "personnel" || d.type === "ship") &&
        (d.traits?.some((t) => t === traitName) ?? false);
    }

    requirements.push({ count, label: desc, matches: matchFn });
  }

  return requirements;
}

function canResolveMission(
  player: PlayerState,
  missionDef: CardDef,
  bases?: Record<string, BaseCardDef>,
): boolean {
  const requirements = parseMissionRequirements(missionDef);
  if (requirements.length === 0) return true;

  // Collect available alert face-up units (exclude Olympic Carrier itself)
  const availableUnits: CardDef[] = [];
  for (const stack of player.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard && topCard.faceUp && !stack.exhausted) {
      const def = getCardDef(topCard.defId);
      if (def.type === "personnel" || def.type === "ship") {
        availableUnits.push(def);
      }
    }
  }

  // Greedy assignment: for each requirement, count matching units
  // Each unit can only satisfy one requirement
  const used = new Set<number>();
  let totalShortfall = 0;

  for (const req of requirements) {
    let satisfied = 0;
    for (let i = 0; i < availableUnits.length; i++) {
      if (used.has(i)) continue;
      if (req.matches(availableUnits[i])) {
        used.add(i);
        satisfied++;
        if (satisfied >= req.count) break;
      }
    }

    // Check base with countsAsCivilian hook for Civilian requirements
    if (satisfied < req.count && req.label.toLowerCase().includes("civilian") && bases) {
      const baseDef = bases[player.baseDefId];
      if (baseDef?.abilityId) {
        const baseHandler = getBaseAbilityHandler(baseDef.abilityId);
        if (baseHandler?.countsAsCivilian) {
          const baseStack = player.zones.resourceStacks[0];
          if (baseStack && !baseStack.exhausted) {
            satisfied++;
          }
        }
      }
    }

    if (satisfied < req.count) {
      totalShortfall += req.count - satisfied;
    }
  }

  if (totalShortfall === 0) return true;

  // Olympic Carrier: sacrifice to meet any 2 requirements of a Cylon mission
  if (totalShortfall <= 2 && missionDef.traits?.includes("Cylon") && findOlympicCarrier(player)) {
    return true;
  }

  return false;
}

/** Find an alert, face-up Olympic Carrier (olympic-carrier-mission) in a player's fleet. */
function findOlympicCarrier(player: PlayerState): { stack: UnitStack; index: number } | null {
  for (let i = 0; i < player.zones.alert.length; i++) {
    const stack = player.zones.alert[i];
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (def.abilityId === "olympic-carrier-mission") return { stack, index: i };
  }
  return null;
}

// ============================================================
// Apply Action
// ============================================================

export function applyAction(
  state: GameState,
  playerIndex: number,
  action: GameAction,
  bases: Record<string, BaseCardDef>,
): { state: GameState; log: LogItem[] } {
  const s = cloneState(state);
  const log: LogItem[] = [];
  const pLabel = s.playerNames[playerIndex as 0 | 1];
  const player = s.players[playerIndex];
  const opponent = s.players[1 - playerIndex];

  switch (action.type) {
    // --- Setup: mulligan ---
    case "keepHand": {
      player.hasMulliganed = true;
      log.push(`${pLabel} keeps their hand.`);
      checkSetupComplete(s, log, bases);
      break;
    }
    case "redraw": {
      const baseDef = bases[player.baseDefId];
      // Put hand back into deck
      player.deck.push(...player.hand);
      player.hand = [];
      shuffle(player.deck);
      drawCards(player, baseDef.handSize, log, pLabel);
      player.hasMulliganed = true;
      log.push(`${pLabel} redraws their hand.`);
      checkSetupComplete(s, log, bases);
      break;
    }

    // --- Ready phase step 4: play to resource ---
    case "playToResource": {
      const card = player.hand[action.cardIndex];
      if (!card) break;
      player.hand.splice(action.cardIndex, 1);
      const def = getCardDef(card.defId);

      if (action.asSupply) {
        const stackIdx = action.targetStackIndex ?? 0;
        const stack = player.zones.resourceStacks[stackIdx];
        if (stack) {
          card.faceUp = false;
          stack.supplyCards.push(card);
          log.push(`${pLabel} plays ${cardName(def)} as a supply card.`);
        }
      } else {
        // Play as new asset
        const newStack: ResourceStack = { topCard: card, supplyCards: [], exhausted: false };
        player.zones.resourceStacks.push(newStack);
        log.push(`${pLabel} plays ${cardName(def)} as an asset.`);
      }
      player.hasPlayedResource = true;
      advanceReadyStep4(s, log, bases);
      break;
    }
    case "passResource": {
      player.hasPlayedResource = true;
      log.push(`${pLabel} passes on playing to resource area.`);
      advanceReadyStep4(s, log, bases);
      break;
    }

    // --- Ready phase step 3: draw cards ---
    case "drawCards": {
      for (let i = 0; i < s.players.length; i++) {
        drawCards(s.players[i], 2, log, s.playerNames[i as 0 | 1]);
      }
      log.push("All players draw 2 cards.");
      s.readyStep = 4 as ReadyStep;
      s.activePlayerIndex = s.firstPlayerIndex;
      for (const p of s.players) {
        p.hasPlayedResource = false;
      }
      break;
    }

    // --- Ready phase step 5: reorder a stack ---
    case "reorderStack": {
      const { stackInstanceId, newTopDefId } = action;
      // Find the stack and move the matching card to top
      for (const zone of [player.zones.alert, player.zones.reserve]) {
        for (const stack of zone) {
          if (stack.cards[0]?.instanceId === stackInstanceId) {
            const idx = stack.cards.findIndex((c) => c.defId === newTopDefId);
            if (idx > 0) {
              const [card] = stack.cards.splice(idx, 1);
              stack.cards.unshift(card);
              const def = getCardDef(newTopDefId);
              log.push(`${pLabel} reorders stack: ${cardName(def)} is now on top.`);
            }
          }
        }
      }
      break;
    }

    // --- Ready phase step 5: done reorder ---
    case "doneReorder": {
      advanceReadyStep5(s, log, bases);
      break;
    }

    // --- Execution phase: play a card ---
    case "playCard": {
      const card = player.hand[action.cardIndex];
      if (!card) break;
      const def = getCardDef(card.defId);

      // Validate affordability before spending
      if (!canAfford(player, def, bases)) {
        log.push(`${pLabel} cannot afford ${cardName(def)}.`);
        break;
      }

      // Apply cost reduction (Refinery Ship)
      let effectiveCost = def.cost;
      let hadCostReduction = false;
      if (player.costReduction && def.cost) {
        hadCostReduction = true;
        const reduced: Record<string, number> = {};
        for (const [resType, amount] of Object.entries(def.cost) as [string, number][]) {
          const reduction = player.costReduction[resType as keyof typeof player.costReduction] ?? 0;
          const newAmount = Math.max(0, amount - reduction);
          if (newAmount > 0) reduced[resType] = newAmount;
        }
        effectiveCost = Object.keys(reduced).length > 0 ? (reduced as typeof def.cost) : null;
        player.costReduction = undefined;
        log.push("Refinery Ship: Cost reduced by 1.");
      }

      // Pay cost — use player selection if provided, otherwise auto-select
      // If cost reduction changed the effective cost, ignore client stack selection
      // (client doesn't know about the reduction)
      const stackSelection =
        !hadCostReduction && action.selectedStackIndices ? action.selectedStackIndices : undefined;
      const excessResources =
        stackSelection && validateStackSelection(player, effectiveCost, bases, stackSelection)
          ? payResourceCostWithSelection(player, effectiveCost, bases, stackSelection, log)
          : payResourceCost(player, effectiveCost, bases, log);
      player.hand.splice(action.cardIndex, 1);

      if (isUnit(def) || isMission(def)) {
        // Singular units overlay onto existing stacks with the same title
        // We'll See You Again: singular cards don't overlay Cylon stacks
        const overlayTarget =
          isUnit(def) && isSingular(def) && !checkMissionOverlayPrevention(s, playerIndex, def)
            ? findOverlayTarget(player, def)
            : null;

        if (overlayTarget) {
          // Overlay: push new card on top of the stack
          overlayTarget.stack.cards.unshift(card);
          // Restore exhausted cards in the stack when overlaid
          overlayTarget.stack.exhausted = false;
          log.push(
            `${pLabel} overlays ${cardName(def)} onto existing ${def.title} stack (${overlayTarget.zone}).`,
          );
        } else {
          // No overlay target — new stack in reserve
          player.zones.reserve.push({ cards: [card], exhausted: false });
          log.push(`${pLabel} plays ${cardName(def)} to reserve.`);
        }
        // Fire enter-play triggers for units
        if (isUnit(def)) {
          fireOnEnterPlay(s, playerIndex, def, card.instanceId, log);
          // Fire ship-enter-play trigger (Galen Tyrol The Chief)
          if (def.type === "ship") {
            fireOnShipEnterPlay(s, playerIndex, card.instanceId, log);
          }
        }
      } else if (def.type === "event") {
        // Resolve event effect
        log.push(`${pLabel} plays event ${cardName(def)}.`);
        resolveEventEffect(s, playerIndex, def, log, action.targetInstanceId);
        if (!s.skipEventDiscard) {
          player.discard.push(card);
        }
        s.skipEventDiscard = undefined;
        // Fire mission event-play triggers (Dradis Contact: +1 influence per event)
        fireMissionOnEventPlay(s, playerIndex, log);
      }

      resetConsecutivePasses(s);
      player.consecutivePasses = 0;

      // Expedite: check if any card in hand has Expedite and can be paid with excess
      if (!s.pendingChoice) {
        const totalExcess =
          excessResources.persuasion + excessResources.logistics + excessResources.security;
        if (totalExcess > 0) {
          const eligibleIndices: number[] = [];
          for (let ei = 0; ei < player.hand.length; ei++) {
            const expDef = getCardDef(player.hand[ei].defId);
            if (!hasKeyword(expDef, "Expedite") || !expDef.cost) continue;
            let canExp = true;
            for (const [rt, amt] of Object.entries(expDef.cost) as [ResourceType, number][]) {
              if ((excessResources[rt] ?? 0) < amt) {
                canExp = false;
                break;
              }
            }
            if (canExp) eligibleIndices.push(ei);
          }
          if (eligibleIndices.length > 0) {
            s.pendingChoice = {
              type: "expedite-choice",
              playerIndex,
              cards: eligibleIndices.map((i) => player.hand[i]),
              prompt: "Expedite — play an additional card with excess resources?",
              context: {
                excessResources: { ...excessResources },
                eligibleIndices,
              },
            };
          }
        }
      }

      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        if (s.pendingChoice) {
          // Stay on same player for choice resolution (e.g. ETB triggers, event choices)
        } else {
          advanceExecutionTurn(s);
        }
      }
      break;
    }

    // --- Execution phase: play ability ---
    case "playAbility": {
      const { sourceInstanceId, targetInstanceId } = action;

      // Check if it's the base ability
      const baseStack = player.zones.resourceStacks[0];
      if (baseStack && baseStack.topCard.instanceId === sourceInstanceId) {
        const baseDef = bases[player.baseDefId];
        if (baseDef?.abilityId) {
          baseStack.exhausted = true;
          log.push(`${pLabel} exhausts ${baseDef.title} to use its ability.`);
          resolveBaseAbilityEffect(baseDef.abilityId, s, playerIndex, targetInstanceId, log, bases);
          resetConsecutivePasses(s);
          player.consecutivePasses = 0;
          checkVictory(s, log);
          if (s.phase !== "gameOver") {
            // Celestra: if pendingChoice was set, don't advance turn yet
            if (s.pendingChoice) {
              // Stay on same player — they need to resolve the choice
            } else if (s.challenge) {
              advanceChallengeEffectTurn(s);
            } else {
              advanceExecutionTurn(s);
            }
          }
        }
        break;
      }

      // Check alert units (unit abilities via registry)
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.instanceId === sourceInstanceId) {
          const def = getCardDef(topCard.defId);
          if (!def.abilityId) break;

          const costType = getUnitAbilityCost(def.abilityId);
          log.push(`${pLabel} uses ${cardName(def)}'s ability.`);

          // Pay activation cost
          if (costType === "commit") {
            commitUnit(player, sourceInstanceId, log);
          } else if (costType === "commit-exhaust") {
            commitUnit(player, sourceInstanceId, log);
            const found = findUnitInAnyZone(player, sourceInstanceId);
            if (found) found.stack.exhausted = true;
          } else if (costType === "commit-sacrifice") {
            // Remove unit entirely (sacrifice)
            const found = findUnitInAnyZone(player, sourceInstanceId);
            if (found) {
              const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
              zone.splice(found.index, 1);
              for (const card of found.stack.cards) {
                player.discard.push(card);
              }
            }
          } else if (costType === "exhaust") {
            // Exhaust-only: flip face-down but stay in current zone
            stack.exhausted = true;
          } else if (costType === "commit-other" || costType === "sacrifice-other") {
            // The target IS the other unit to commit/sacrifice as cost
            if (targetInstanceId) {
              if (costType === "commit-other") {
                commitUnit(player, targetInstanceId, log);
              } else {
                // sacrifice-other
                const found = findUnitInAnyZone(player, targetInstanceId);
                if (found) {
                  const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
                  zone.splice(found.index, 1);
                  for (const card of found.stack.cards) {
                    player.discard.push(card);
                  }
                }
              }
            }
            // For commit-other/sacrifice-other, the source unit stays in play
            // but the self-buff is applied via challenge state
            if (s.challenge && s.challenge.challengerInstanceId === sourceInstanceId) {
              const buffAmount =
                costType === "sacrifice-other"
                  ? 3
                  : def.abilityId
                    ? getCommitOtherPowerBuff(def.abilityId)
                    : 1;
              s.challenge.challengerPowerBuff = (s.challenge.challengerPowerBuff ?? 0) + buffAmount;
            } else if (s.challenge && s.challenge.defenderInstanceId === sourceInstanceId) {
              const buffAmount =
                costType === "sacrifice-other"
                  ? 3
                  : def.abilityId
                    ? getCommitOtherPowerBuff(def.abilityId)
                    : 1;
              s.challenge.defenderPowerBuff = (s.challenge.defenderPowerBuff ?? 0) + buffAmount;
            }
          }

          // Resolve the ability effect
          resolveUnitAbility(
            def.abilityId,
            s,
            playerIndex,
            sourceInstanceId,
            targetInstanceId,
            log,
          );

          resetConsecutivePasses(s);
          player.consecutivePasses = 0;
          checkVictory(s, log);
          if (s.phase !== "gameOver") {
            // Cloud 9 Transport Hub: forceEnd ends the challenge immediately
            if (s.challenge?.forceEnd) {
              fireOnChallengeEnd(s, s.challenge, log);
              s.challenge = null;
              advanceExecutionTurn(s);
            } else if (s.pendingChoice) {
              // Stay on same player for choice resolution
            } else if (s.challenge) {
              advanceChallengeEffectTurn(s);
            } else {
              advanceExecutionTurn(s);
            }
          }
          break;
        }
      }

      // Check mission activated abilities (persistent + link)
      // For persistent missions: sourceInstanceId matches a persistent mission instanceId
      // For link missions: sourceInstanceId matches the linked unit's instanceId
      {
        let handled = false;
        // Check persistent missions
        for (const mc of player.zones.persistentMissions ?? []) {
          if (mc.instanceId === sourceInstanceId) {
            const mDef = getCardDef(mc.defId);
            if (mDef?.abilityId) {
              log.push(`${pLabel} activates ${cardName(mDef)}.`);
              resolveMissionActivation(
                mDef.abilityId,
                s,
                playerIndex,
                sourceInstanceId,
                targetInstanceId,
                log,
              );
              handled = true;
              resetConsecutivePasses(s);
              player.consecutivePasses = 0;
              checkVictory(s, log);
              if (s.phase !== "gameOver") {
                if (s.pendingChoice) {
                  /* stay on same player */
                } else advanceExecutionTurn(s);
              }
            }
            break;
          }
        }
        // Check linked missions on alert units (sourceInstanceId = unit's instanceId)
        if (!handled) {
          for (const stack of player.zones.alert) {
            const top = stack.cards[0];
            if (top?.instanceId === sourceInstanceId) {
              for (const mc of stack.linkedMissions ?? []) {
                const mDef = getCardDef(mc.defId);
                if (mDef?.abilityId) {
                  const cat = getMissionCategory(mDef.abilityId);
                  if (cat === "link") {
                    log.push(`${pLabel} activates ${cardName(mDef)} (linked).`);
                    // Pay cost: commit the unit
                    commitUnit(player, sourceInstanceId, log);
                    resolveMissionActivation(
                      mDef.abilityId,
                      s,
                      playerIndex,
                      sourceInstanceId,
                      targetInstanceId,
                      log,
                    );
                    handled = true;
                    resetConsecutivePasses(s);
                    player.consecutivePasses = 0;
                    checkVictory(s, log);
                    if (s.phase !== "gameOver") {
                      if (s.pendingChoice) {
                        /* stay on same player */
                      } else advanceExecutionTurn(s);
                    }
                    break;
                  }
                }
              }
              break;
            }
          }
        }
      }
      break;
    }

    // --- Execution phase: resolve mission ---
    case "resolveMission": {
      const found = findUnitInZone(player.zones.alert, action.missionInstanceId);
      if (!found) break;
      const def = getCardDef(found.stack.cards[0].defId);

      log.push(`${pLabel} resolves mission ${cardName(def)}.`);

      // Auto-exhaust Colonial Heavy 798 if needed for Civilian requirements
      if (hasColonialHeavy798(s, playerIndex, bases)) {
        const reqs = parseMissionRequirements(def);
        const hasCivilianReq = reqs.some((r) => r.label.toLowerCase().includes("civilian"));
        if (hasCivilianReq) {
          exhaustColonialHeavy798(s, playerIndex, log, bases);
        }
      }

      // Olympic Carrier: sacrifice to meet 2 requirements of a Cylon mission
      if (def.traits?.includes("Cylon")) {
        const oc = findOlympicCarrier(player);
        if (oc) {
          // Only sacrifice if needed (can't resolve without it)
          // Temporarily remove Olympic Carrier from alert to test
          const [ocStack] = player.zones.alert.splice(oc.index, 1);
          const canWithout = canResolveMission(player, def, bases);
          if (!canWithout) {
            // Sacrifice: send all cards to discard
            for (const card of ocStack.cards) {
              player.discard.push(card);
            }
            log.push("Olympic Carrier, Trojan Horse: sacrificed to meet 2 mission requirements.");
          } else {
            // Put it back — not needed
            player.zones.alert.splice(oc.index, 0, ocStack);
          }
        }
      }

      resolveMissionEffect(s, playerIndex, def, log, action.targetInstanceId);

      // Remove mission from alert — destination depends on category
      const [missionStack] = player.zones.alert.splice(found.index, 1);
      const missionCard = missionStack.cards[0];
      const category = def.abilityId ? getMissionCategory(def.abilityId) : "one-shot";

      if (category === "persistent") {
        if (!player.zones.persistentMissions) player.zones.persistentMissions = [];
        player.zones.persistentMissions.push(missionCard);
        log.push(`${cardName(def)} is Persistent — stays in play.`);
      } else if (category === "link") {
        // If human player chose a link target, use it; otherwise AI auto-picks
        let linkTarget: UnitStack | null = null;
        if (action.linkTargetInstanceId) {
          for (const zone of [player.zones.alert, player.zones.reserve]) {
            for (const st of zone) {
              if (st.cards[0]?.instanceId === action.linkTargetInstanceId) {
                linkTarget = st;
                break;
              }
            }
            if (linkTarget) break;
          }
        } else {
          const linkType = getLinkTargetType(def.abilityId!);
          linkTarget = pickLinkTarget(player, linkType, def);
        }
        if (linkTarget) {
          if (!linkTarget.linkedMissions) linkTarget.linkedMissions = [];
          linkTarget.linkedMissions.push(missionCard);
          const targetDef = getCardDef(linkTarget.cards[0].defId);
          log.push(`${cardName(def)} linked to ${cardName(targetDef)}.`);
        } else {
          player.discard.push(missionCard);
          log.push(`${cardName(def)} — no valid link target, discarded.`);
        }
      } else {
        for (const card of missionStack.cards) {
          player.discard.push(card);
        }
      }

      player.hasResolvedMission = true;
      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        if (s.forceEndExecution) {
          s.forceEndExecution = undefined;
          log.push({ msg: "Execution phase ends (False Peace).", d: 0, cat: "phase" });
          startCylonPhase(s, log, bases);
        } else if (s.pendingChoice) {
          // Stay on same player for choice resolution
        } else {
          advanceExecutionTurn(s);
        }
      }
      break;
    }

    // --- Execution phase: challenge ---
    case "challenge": {
      const challengerInstanceId = action.challengerInstanceId;
      const challengerDef = findCardDefByInstanceId(s, challengerInstanceId);
      if (!challengerDef) break;

      // Difference of Opinion: pay resource cost for challenging
      const challengeCost = getMissionChallengeCost(s, playerIndex, 1 - playerIndex);
      if (challengeCost > 0) {
        spendAnyResources(player, challengeCost, log);
      }

      const selector = getDefenderSelector(challengerDef);
      log.push({
        msg: `${pLabel} challenges with ${cardName(challengerDef)}.`,
        d: 0,
        p: playerIndex,
        cat: "flow",
      });

      s.challenge = {
        challengerInstanceId,
        challengerPlayerIndex: playerIndex,
        defenderInstanceId: null,
        defenderPlayerIndex: 1 - playerIndex,
        step: 1,
        challengerMysticValue: null,
        defenderMysticValue: null,
        waitingForDefender: true,
        defenderSelector: selector,
        consecutivePasses: 0,
        isCylonChallenge: false,
      };

      resetConsecutivePasses(s);
      player.consecutivePasses = 0;

      // Fire onChallengeInit triggers (e.g., Viper 762: commit Pilot for +3)
      fireOnChallengeInit(s, playerIndex, challengerInstanceId, log);

      // Check for Agro Ship / Flattop trigger on the defending player
      const defenderIdx = 1 - playerIndex;
      const trigger = getOnChallengedTrigger(s, defenderIdx, bases);
      if (trigger) {
        s.challenge.pendingTrigger = { abilityId: trigger.abilityId, playerIndex: defenderIdx };
        s.challenge.waitingForDefender = false; // trigger resolves first
        s.activePlayerIndex = defenderIdx;
      } else {
        // Check for Tigh XO on defending player (readies from reserve when challenged)
        const tigh = findReserveTighXO(s.players[defenderIdx]);
        if (tigh) {
          s.challenge.pendingTrigger = {
            abilityId: "tigh-xo",
            playerIndex: defenderIdx,
            sourceInstanceId: tigh.instanceId,
          };
          s.challenge.waitingForDefender = false;
          s.activePlayerIndex = defenderIdx;
        } else {
          // Who picks the defender: Sniper → challenger, otherwise → defending player
          s.activePlayerIndex = selector === "challenger" ? playerIndex : 1 - playerIndex;
        }
      }
      break;
    }

    // --- Sniper: defender accepts or declines defense ---
    case "sniperAccept": {
      if (!s.challenge) break;
      if (action.accept) {
        s.challenge.sniperDefendAccepted = true;
        log.push(`${pLabel} accepts defense.`);
        // Now challenger picks the defending unit
        s.activePlayerIndex = s.challenge.challengerPlayerIndex;
      } else {
        log.push(`${pLabel} declines to defend.`);
        s.challenge.waitingForDefender = false;
        s.challenge.step = 2;
        s.challenge.consecutivePasses = 0;
        log.push({ msg: "── Effects round ──", d: 1, cat: "flow" });
        s.activePlayerIndex = s.challenge.challengerPlayerIndex;
      }
      break;
    }

    // --- Defend response ---
    case "defend": {
      if (!s.challenge) break;

      if (action.defenderInstanceId) {
        // Check if defender is being flash-played from hand (Raptor 432)
        const handIndex = player.hand.findIndex((c) => c.instanceId === action.defenderInstanceId);
        if (handIndex >= 0) {
          const card = player.hand[handIndex];
          const flashDef = getCardDef(card.defId);
          payResourceCost(player, flashDef.cost, bases, log);
          player.hand.splice(handIndex, 1);
          // Play to reserve as a unit
          player.zones.reserve.push({
            cards: [card],
            exhausted: false,
          });
          log.push(`${pLabel} flash plays ${cardName(flashDef)} from hand to defend.`);
        }
        const defDef = findCardDefByInstanceId(s, action.defenderInstanceId);
        s.challenge.defenderInstanceId = action.defenderInstanceId;
        if (handIndex < 0) {
          log.push(`${pLabel} defends with ${defDef?.title ?? defDef?.subtitle ?? "unknown"}.`);
        }
      } else {
        log.push(`${pLabel} declines to defend.`);
      }
      s.challenge.waitingForDefender = false;
      s.challenge.step = 2;
      s.challenge.consecutivePasses = 0;
      log.push({ msg: "── Effects round ──", d: 1, cat: "flow" });
      // Challenging player gets first chance to play effects
      s.activePlayerIndex = s.challenge.challengerPlayerIndex;
      break;
    }

    // --- Challenge step 2: pass on effects ---
    case "challengePass": {
      if (!s.challenge) break;
      s.challenge.consecutivePasses++;
      log.push({ msg: `${pLabel} passes in the challenge.`, d: 1, p: playerIndex });

      if (s.challenge.consecutivePasses >= 2) {
        // All passed, resolve challenge
        resolveChallenge(s, log, bases);
      } else {
        advanceChallengeEffectTurn(s);
      }
      break;
    }

    // --- Challenge step 2: play event during challenge ---
    case "playEventInChallenge": {
      if (!s.challenge) break;
      const card = player.hand[action.cardIndex];
      if (!card) break;
      const def = getCardDef(card.defId);

      // Pay cost — use player selection if provided, otherwise auto-select
      const challengeStackSel = action.selectedStackIndices;
      if (challengeStackSel && validateStackSelection(player, def.cost, bases, challengeStackSel)) {
        payResourceCostWithSelection(player, def.cost, bases, challengeStackSel, log);
      } else {
        payResourceCost(player, def.cost, bases, log);
      }
      player.hand.splice(action.cardIndex, 1);

      log.push(`${pLabel} plays ${cardName(def)} during challenge.`);
      resolveEventEffect(s, playerIndex, def, log, action.targetInstanceId);
      if (!s.skipEventDiscard) {
        player.discard.push(card);
      }
      s.skipEventDiscard = undefined;

      s.challenge!.consecutivePasses = 0;
      // Sign / forceEnd: end challenge immediately
      if (s.challenge?.forceEnd) {
        fireOnChallengeEnd(s, s.challenge, log);
        s.challenge = null;
        advanceExecutionTurn(s);
      } else if (s.pendingChoice) {
        // Stay on same player for choice resolution
      } else {
        advanceChallengeEffectTurn(s);
      }
      break;
    }

    // --- Execution phase: pass ---
    case "pass": {
      player.consecutivePasses++;
      log.push(`${pLabel} passes.`);

      // Check if all players have passed consecutively
      if (s.players.every((p) => p.consecutivePasses > 0)) {
        // Execution phase ends, move to Cylon phase
        log.push({ msg: "All players passed. Execution phase ends.", d: 0, cat: "phase" });
        startCylonPhase(s, log, bases);
      } else {
        advanceExecutionTurn(s);
      }
      break;
    }

    // --- Cylon phase: challenge a threat ---
    case "challengeCylon": {
      const threatIdx = action.threatIndex;
      const threat = s.cylonThreats[threatIdx];
      if (!threat) break;

      const challengerDef = findCardDefByInstanceId(s, action.challengerInstanceId);
      log.push({
        msg: `${pLabel} challenges Cylon threat (power ${threat.power}) with ${challengerDef ? cardName(challengerDef) : "unknown"}.`,
        d: 0,
        p: playerIndex,
        cat: "flow",
      });

      // The player to the left is the "Cylon player"
      const cylonPlayerIndex = (playerIndex + 1) % s.players.length;

      s.challenge = {
        challengerInstanceId: action.challengerInstanceId,
        challengerPlayerIndex: playerIndex,
        defenderInstanceId: threat.card.instanceId,
        defenderPlayerIndex: cylonPlayerIndex,
        step: 2, // skip to effects round (no defender choice for Cylon threats)
        challengerMysticValue: null,
        defenderMysticValue: null,
        waitingForDefender: false,
        defenderSelector: "defender", // N/A for Cylon challenges
        consecutivePasses: 0,
        isCylonChallenge: true,
        cylonThreatIndex: threatIdx,
        cylonPlayerIndex: cylonPlayerIndex,
      };

      resetConsecutivePasses(s);
      // Challenger gets first chance to play effects
      s.activePlayerIndex = playerIndex;
      break;
    }

    // --- Cylon phase: pass ---
    case "passCylon": {
      applyInfluenceLoss(s, playerIndex, 1, log, bases);
      player.consecutivePasses++;
      log.push(`${pLabel} stands down (pass — lose 1 influence).`);
      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        // Check if all passed consecutively or no threats remain
        if (s.players.every((p) => p.consecutivePasses > 0) || s.cylonThreats.length === 0) {
          endCylonPhase(s, log, bases);
        } else {
          advanceCylonTurn(s);
        }
      }
      break;
    }

    // --- Triggered ability: use (Agro Ship / Flattop / Tigh XO) ---
    case "useTriggeredAbility": {
      if (!s.challenge?.pendingTrigger) break;
      const triggerAbilityId = s.challenge.pendingTrigger.abilityId;
      const triggerPlayerIdx = s.challenge.pendingTrigger.playerIndex;
      const triggerPlayer = s.players[triggerPlayerIdx];

      if (triggerAbilityId === "tigh-xo") {
        // Tigh XO: ready from reserve
        const sourceId = s.challenge.pendingTrigger.sourceInstanceId!;
        readyUnit(triggerPlayer, sourceId, log);
        s.challenge.tighXoReadied = sourceId;

        // Clear trigger, proceed to defender selection
        s.challenge.pendingTrigger = undefined;
        s.challenge.waitingForDefender = true;
        s.activePlayerIndex =
          s.challenge.defenderSelector === "challenger"
            ? s.challenge.challengerPlayerIndex
            : s.challenge.defenderPlayerIndex;
      } else {
        // Base trigger (Agro Ship / Flattop): exhaust base and resolve
        const triggerBaseStack = triggerPlayer.zones.resourceStacks[0];
        if (triggerBaseStack) {
          triggerBaseStack.exhausted = true;
        }
        const triggerBaseDef = bases[triggerPlayer.baseDefId];
        log.push(`${pLabel} exhausts ${triggerBaseDef.title}.`);

        resolveBaseAbilityEffect(
          triggerAbilityId,
          s,
          triggerPlayerIdx,
          action.targetInstanceId,
          log,
          bases,
        );

        // Clear base trigger, check for Tigh XO chain
        s.challenge.pendingTrigger = undefined;
        const tigh = findReserveTighXO(triggerPlayer);
        if (tigh) {
          s.challenge.pendingTrigger = {
            abilityId: "tigh-xo",
            playerIndex: triggerPlayerIdx,
            sourceInstanceId: tigh.instanceId,
          };
          s.activePlayerIndex = triggerPlayerIdx;
        } else {
          s.challenge.waitingForDefender = true;
          s.activePlayerIndex =
            s.challenge.defenderSelector === "challenger"
              ? s.challenge.challengerPlayerIndex
              : s.challenge.defenderPlayerIndex;
        }
      }
      break;
    }

    // --- Triggered ability: decline ---
    case "declineTrigger": {
      if (!s.challenge?.pendingTrigger) break;
      const isBaseTrigger = s.challenge.pendingTrigger.abilityId !== "tigh-xo";
      const declineTriggerPlayerIdx = s.challenge.pendingTrigger.playerIndex;
      log.push(`${pLabel} declines to use triggered ability.`);
      s.challenge.pendingTrigger = undefined;

      // If base trigger was declined, check for Tigh XO chain
      if (isBaseTrigger) {
        const tigh = findReserveTighXO(s.players[declineTriggerPlayerIdx]);
        if (tigh) {
          s.challenge.pendingTrigger = {
            abilityId: "tigh-xo",
            playerIndex: declineTriggerPlayerIdx,
            sourceInstanceId: tigh.instanceId,
          };
          s.activePlayerIndex = declineTriggerPlayerIdx;
          break;
        }
      }

      s.challenge.waitingForDefender = true;
      s.activePlayerIndex =
        s.challenge.defenderSelector === "challenger"
          ? s.challenge.challengerPlayerIndex
          : s.challenge.defenderPlayerIndex;
      break;
    }

    // --- Pending choice resolution (Celestra) ---
    case "makeChoice": {
      if (!s.pendingChoice) break;
      const choice = s.pendingChoice;
      const hadChallenge = !!s.challenge;
      resolvePendingChoice(s, choice, action.choiceIndex, player, playerIndex, log, bases);
      // Only clear if resolvePendingChoice didn't set up a new chained choice
      if (s.pendingChoice === choice) {
        s.pendingChoice = undefined;
      }
      // If the resolution set up a NEW pendingChoice (chained), stay on same player
      if (s.pendingChoice) {
        // Stay on same player for next choice
      } else if (s.fleetJumpPending) {
        // Fleet jump sacrifice — chain to next player or finish
        const nextPlayer = (playerIndex + 1) % s.players.length;
        if (nextPlayer === s.firstPlayerIndex) {
          finishFleetJump(s, log, bases);
        } else {
          setupFleetJumpSacrifice(s, log, bases, nextPlayer);
        }
      } else if (s.cylonPhaseResumeNeeded) {
        // Cylon phase was paused for base ability choices — resume
        s.cylonPhaseResumeNeeded = undefined;
        resumeAfterCylonReveal(s, log, bases);
      } else if (hadChallenge && !s.challenge) {
        // Challenge was fully resolved inside resolvePendingChoice (already advanced)
      } else if (s.challenge) {
        advanceChallengeEffectTurn(s);
      } else {
        advanceExecutionTurn(s);
      }
      break;
    }

    case "sacrificeFromStack": {
      const { stackInstanceId, cardInstanceId } = action;
      // Find the unit stack containing the top card
      let targetStack: UnitStack | null = null;
      for (const stack of player.zones.alert) {
        if (stack.cards[0]?.instanceId === stackInstanceId) {
          targetStack = stack;
          break;
        }
      }
      if (!targetStack || targetStack.cards.length < 2) break;
      // Find and remove the non-top card
      const cardIdx = targetStack.cards.findIndex((c) => c.instanceId === cardInstanceId);
      if (cardIdx <= 0) break; // can't sacrifice top card (index 0)
      const [sacrificed] = targetStack.cards.splice(cardIdx, 1);
      player.discard.push(sacrificed);
      const topDef = getCardDef(targetStack.cards[0].defId);
      const sacDef = getCardDef(sacrificed.defId);
      log.push(
        `${pLabel} sacrifices ${cardName(sacDef)} from ${cardName(topDef)} stack (+1 power).`,
      );
      // Apply +1 power buff to the top unit
      applyPowerBuff(s, targetStack.cards[0].instanceId, 1, log);
      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
      if (s.challenge) {
        advanceChallengeEffectTurn(s);
      } else {
        advanceExecutionTurn(s);
      }
      break;
    }
  }

  const stamped = stampLog(log);
  s.log.push(...stamped);
  return { state: s, log: stamped };
}

// ============================================================
// Phase Transitions
// ============================================================

function checkSetupComplete(
  s: GameState,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  if (s.players.every((p) => p.hasMulliganed)) {
    log.push("Both players ready. Starting Turn 1.");
    startReadyPhase(s, log, bases);
  }
}

function startReadyPhase(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  s.turn++;
  s.phase = "ready";
  s.firstPlayerIndex = determineFirstPlayer(s);
  s.activePlayerIndex = s.firstPlayerIndex;

  log.push(`--- Turn ${s.turn} ---`);

  // Step 1: Ready face-up units and missions from reserve → alert
  for (const player of s.players) {
    const toReady: UnitStack[] = [];
    const remaining: UnitStack[] = [];
    for (const stack of player.zones.reserve) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        toReady.push(stack);
      } else {
        remaining.push(stack);
      }
    }
    player.zones.reserve = remaining;
    player.zones.alert.push(...toReady);
    if (toReady.length > 0) {
      const names = toReady.map((st) => cardName(getCardDef(st.cards[0].defId))).join(", ");
      log.push(`${pName(s, s.players.indexOf(player))} readies: ${names}.`);
    }
  }

  // Clear once-per-turn tracking and temporary modifiers
  for (const player of s.players) {
    player.oncePerTurnUsed = undefined;
    player.temporaryTraitGrants = undefined;
    player.temporaryKeywordGrants = undefined;
    player.temporaryCylonThreatMods = undefined;
    player.temporaryTraitRemovals = undefined;
    player.extraActionsRemaining = undefined;
    player.costReduction = undefined;
  }
  // Clear False Peace phase tracking
  s.extraPhases = undefined;
  s.forceEndExecution = undefined;
  s.effectImmunity = undefined;

  // Step 2: Restore exhausted cards
  for (const player of s.players) {
    for (const stack of player.zones.resourceStacks) {
      stack.exhausted = false;
    }
    for (const stack of player.zones.alert) {
      stack.exhausted = false;
    }
    for (const stack of player.zones.reserve) {
      stack.exhausted = false;
    }
    // Restore persistent missions (they can be exhausted by activations)
    for (const mc of player.zones.persistentMissions ?? []) {
      mc.faceUp = true;
    }
  }

  // Fire mission ready-phase triggers (Multiple Contacts: draw 1 card)
  fireMissionOnReadyPhaseStart(s, log);

  // Step 3: Wait for draw action
  s.readyStep = 3 as ReadyStep;
  s.activePlayerIndex = s.firstPlayerIndex;
}

function playerHasReorderableStacks(p: GameState["players"][number]): boolean {
  for (const zone of [p.zones.alert, p.zones.reserve]) {
    for (const stack of zone) {
      if (stack.cards.length >= 2) return true;
    }
  }
  return false;
}

function advanceReadyStep4(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  // Check if all players have had their turn at step 4
  if (s.players.every((p) => p.hasPlayedResource)) {
    // Move to step 5 — skip if no player has reorderable stacks
    if (!s.players.some((p) => playerHasReorderableStacks(p))) {
      startExecutionPhase(s, log);
      return;
    }
    s.readyStep = 5 as ReadyStep;
    s.activePlayerIndex = s.firstPlayerIndex;
    log.push("Ready phase: reorder unit stacks.");
    // Skip first player if they have no reorderable stacks
    if (!playerHasReorderableStacks(s.players[s.activePlayerIndex])) {
      advanceReadyStep5(s, log, bases);
    }
  } else {
    // Next player
    s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
  }
}

function advanceReadyStep5(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  // Advance to next player, skipping those without reorderable stacks
  let nextPlayer = (s.activePlayerIndex + 1) % s.players.length;
  while (nextPlayer !== s.firstPlayerIndex) {
    if (playerHasReorderableStacks(s.players[nextPlayer])) {
      s.activePlayerIndex = nextPlayer;
      return;
    }
    nextPlayer = (nextPlayer + 1) % s.players.length;
  }
  // All done, start execution phase
  startExecutionPhase(s, log);
}

function startExecutionPhase(s: GameState, log: LogItem[]): void {
  s.phase = "execution";
  s.firstPlayerIndex = determineFirstPlayer(s);
  s.activePlayerIndex = s.firstPlayerIndex;
  // Clear phase-scoped event flags
  s.preventInfluenceLoss = undefined;
  s.preventInfluenceGain = undefined;
  s.noChallenges = undefined;
  s.politiciansCantDefend = undefined;
  s.effectImmunity = undefined;
  for (const player of s.players) {
    player.consecutivePasses = 0;
    player.hasResolvedMission = false;
  }
  log.push({ msg: "Execution phase begins.", d: 0, cat: "phase" });
}

function advanceExecutionTurn(s: GameState): void {
  const current = s.players[s.activePlayerIndex];
  // Ragnar Anchorage: skip turn advance, grant extra action
  if (current.ragnarExtraAction) {
    current.ragnarExtraAction = false;
    return; // stay on same player
  }
  // Number Six Agent Provocateur: extra actions remaining
  if (current.extraActionsRemaining && current.extraActionsRemaining > 0) {
    current.extraActionsRemaining--;
    return; // stay on same player
  }
  // Clear Ragnar resource override if it wasn't used during the extra action
  current.ragnarResourceOverride = false;
  s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
}

/**
 * Fire Cylon threat red text effects when threats are revealed.
 * Per rules: "red Cylon threat text triggers at this time in turn order if more than one is revealed."
 * Uses cylonThreatImmunity (set by base ability choices) to skip one threat's text for one player.
 */
function fireCylonThreatRedText(
  s: GameState,
  log: LogItem[],
  _bases: Record<string, BaseCardDef>,
): void {
  const immunity = s.cylonThreatImmunity;

  // Fire red text for each threat in turn order
  for (let ti = 0; ti < s.cylonThreats.length; ti++) {
    const threat = s.cylonThreats[ti];
    const def = getCardDef(threat.card.defId);
    if (!def.cylonThreatText) continue;

    const text = def.cylonThreatText.toLowerCase();
    const skipPlayer = immunity && ti === immunity.threatIndex ? immunity.playerIndex : undefined;
    if (skipPlayer !== undefined) {
      log.push(
        `Cylon threat text (${cardName(def)}): "${def.cylonThreatText}" — ${s.playerNames[skipPlayer as 0 | 1]} protected.`,
      );
    } else {
      log.push(`Cylon threat text (${cardName(def)}): "${def.cylonThreatText}"`);
    }

    if (!applyRegisteredCylonThreat(s, def, text, log, skipPlayer)) {
      log.push(`  → (Unhandled red text: "${def.cylonThreatText}")`);
    }
  }
}

// Legacy cylon threat if-else chain removed — all 22 patterns migrated to
// registerCylonThreat() calls in cylon-threat-handlers.ts

function startCylonPhase(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  s.phase = "cylon";
  // Cylon Betrayal override: use forced first player if set
  if (s.cylonPhaseFirstOverride !== undefined) {
    s.firstPlayerIndex = s.cylonPhaseFirstOverride;
    s.cylonPhaseFirstOverride = undefined;
    log.push(`Cylon Betrayal: ${pName(s, s.firstPlayerIndex)} goes first.`);
  } else {
    s.firstPlayerIndex = determineFirstPlayer(s);
  }
  s.activePlayerIndex = s.firstPlayerIndex;
  // Clear phase-scoped event flags
  s.preventInfluenceLoss = undefined;
  s.preventInfluenceGain = undefined;
  s.noChallenges = undefined;
  s.politiciansCantDefend = undefined;
  s.effectImmunity = undefined;
  // Clear persistent power buffs from execution phase
  for (const p of s.players) {
    for (const zone of [p.zones.alert, p.zones.reserve]) {
      for (const stack of zone) {
        if (stack.powerBuff) stack.powerBuff = undefined;
      }
    }
  }

  const threatLevel = computeCylonThreatLevel(s);
  const effectiveDefense =
    s.fleetDefenseLevel + computeFleetDefenseModifiers(s) + computeMissionFleetDefenseModifier(s);
  log.push({
    msg: `Cylon phase: threat level is ${threatLevel}, fleet defense is ${effectiveDefense}.`,
    d: 0,
    cat: "phase",
  });

  if (threatLevel <= effectiveDefense) {
    log.push("No Cylon attack this turn.");
    endCylonPhase(s, log, bases);
    return;
  }

  log.push("Cylon attack! Each player reveals a threat.");

  // Each player reveals top card as Cylon threat
  const doralBonus = computeCylonThreatBonus(s) + computeMissionCylonThreatBonus(s);
  s.cylonThreats = [];
  for (let i = 0; i < s.players.length; i++) {
    const card = revealTopCard(s.players[i], log, s.playerNames[i as 0 | 1]);
    const def = getCardDef(card.defId);
    const threatPower = (def.cylonThreat ?? 0) + doralBonus;
    s.cylonThreats.push({
      card,
      power: threatPower,
      ownerIndex: i,
    });
    log.push(
      `${s.playerNames[i as 0 | 1]} reveals ${cardName(def)} as Cylon threat (power ${threatPower}${doralBonus > 0 ? `, includes +${doralBonus} Doral` : ""}).`,
    );
  }

  // Dispatch onCylonReveal to base abilities (e.g. Blockading Base Star)
  // If a base sets up a pendingChoice, pause and let the player decide before firing red text
  if (dispatchOnCylonReveal(s, log, bases)) {
    return; // paused — resumeAfterCylonReveal will be called after choices resolve
  }

  resumeAfterCylonReveal(s, log, bases);
}

/**
 * Resume cylon phase after threat reveal (and any base ability choices).
 * Fires red text, checks fleet jump, removes 0-power threats.
 */
function resumeAfterCylonReveal(
  s: GameState,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  // Fire Cylon threat red text (rules: "triggers at this time in turn order")
  try {
    fireCylonThreatRedText(s, log, bases);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`fireCylonThreatRedText error: ${errMsg}`);
    log.push(`[Engine error processing Cylon threat text: ${errMsg}]`);
  }

  // Clear immunity after use
  s.cylonThreatImmunity = undefined;

  // Check if ALL revealed threats have the Cylon trait → fleet jumps
  const allCylon = s.cylonThreats.every((t) => {
    const def = getCardDef(t.card.defId);
    return def.traits?.includes("Cylon");
  });
  if (allCylon) {
    log.push(
      "All Cylon threats have the Cylon trait — fleet must jump! Each player sacrifices an asset or supply card.",
    );
    s.fleetJumpPending = true;
    setupFleetJumpSacrifice(s, log, bases, s.firstPlayerIndex);
    return;
  }

  // 1b: Fleet holds — remove 0-power threats, then players challenge or pass
  log.push("Fleet holds position — players must resolve remaining threats.");

  // Remove 0-power threats
  s.cylonThreats = s.cylonThreats.filter((t) => {
    if (t.power === 0) {
      s.players[t.ownerIndex].discard.push(t.card);
      log.push(`Cylon threat ${cardName(getCardDef(t.card.defId))} (power 0) removed.`);
      return false;
    }
    return true;
  });

  if (s.cylonThreats.length === 0) {
    log.push("No Cylon threats remain.");
    endCylonPhase(s, log, bases);
    return;
  }

  // Players take turns challenging or passing
  for (const p of s.players) {
    p.consecutivePasses = 0;
  }
}

/**
 * Set up a fleet-jump sacrifice choice for the given player.
 * If the player has nothing to sacrifice, auto-skip and chain to next player.
 * When all players are done, discard threats and end the phase.
 */
function setupFleetJumpSacrifice(
  s: GameState,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
  playerIndex: number,
): void {
  // Build sacrifice options for this player
  const p = s.players[playerIndex];
  const choices: CardInstance[] = [];

  // Collect assets (non-base resource stacks)
  for (let si = 1; si < p.zones.resourceStacks.length; si++) {
    choices.push(p.zones.resourceStacks[si].topCard);
  }
  // Collect supply cards (one per stack that has supplies)
  for (const stack of p.zones.resourceStacks) {
    if (stack.supplyCards.length > 0) {
      choices.push(stack.supplyCards[stack.supplyCards.length - 1]);
    }
  }

  if (choices.length === 0) {
    log.push(`${pName(s, playerIndex)} has no asset or supply card to sacrifice.`);
    // Chain to next player or finish
    const nextPlayer = (playerIndex + 1) % s.players.length;
    if (nextPlayer === s.firstPlayerIndex) {
      finishFleetJump(s, log, bases);
    } else {
      setupFleetJumpSacrifice(s, log, bases, nextPlayer);
    }
    return;
  }

  s.activePlayerIndex = playerIndex;
  s.pendingChoice = {
    type: "fleet-jump-sacrifice",
    playerIndex,
    cards: choices,
    prompt: `Fleet Jump — ${pName(s, playerIndex)}, choose an asset or supply card to sacrifice`,
  };
}

function finishFleetJump(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  for (const t of s.cylonThreats) {
    s.players[t.ownerIndex].discard.push(t.card);
  }
  s.cylonThreats = [];
  s.fleetJumpPending = undefined;
  endCylonPhase(s, log, bases);
}

function advanceCylonTurn(s: GameState): void {
  s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
}

function endCylonPhase(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  // Put remaining threats into owners' discard piles
  for (const threat of s.cylonThreats) {
    s.players[threat.ownerIndex].discard.push(threat.card);
  }
  s.cylonThreats = [];

  log.push({ msg: "Cylon phase ends.", d: 0, cat: "phase" });
  checkVictory(s, log);
  if (s.phase !== "gameOver") {
    // False Peace: check for queued extra phases
    if (s.extraPhases?.length) {
      const next = s.extraPhases.shift()!;
      if (next === "execution") {
        log.push("Extra execution phase begins (False Peace).");
        startExecutionPhase(s, log);
      }
    } else {
      log.push("Turn ends.");
      startReadyPhase(s, log, bases);
    }
  }
}

// ============================================================
// Challenge Resolution
// ============================================================

function resolveChallenge(s: GameState, log: LogItem[], bases: Record<string, BaseCardDef>): void {
  const challenge = s.challenge!;
  const attackerPlayer = s.players[challenge.challengerPlayerIndex];
  const defenderPlayer = s.players[challenge.defenderPlayerIndex];

  if (challenge.isCylonChallenge) {
    resolveCylonChallenge(s, log, bases);
    return;
  }

  // ============= RESOLUTION PHASE (re-entrant via checkpoint flags) =============
  if (!challenge.resolutionComplete) {
    log.push({ msg: "── Resolution ──", d: 1, cat: "flow" });
    // Find challenger unit
    const challengerStack = findUnitInAnyZone(attackerPlayer, challenge.challengerInstanceId);
    if (!challengerStack) {
      log.push("Challenger left play. Challenge ends.");
      s.challenge = null;
      advanceExecutionTurn(s);
      return;
    }

    if (!challenge.defenderInstanceId) {
      // --- UNDEFENDED CHALLENGE ---

      // Six Seductress: "you can commit this personnel → challenger gets +2 power"
      if (!challenge.sixSeductressChecked) {
        challenge.sixSeductressChecked = true;
        const challengerDef = getCardDef(challengerStack.stack.cards[0].defId);
        if (challengerDef?.type === "personnel") {
          const six = findAlertSixSeductress(attackerPlayer);
          if (six) {
            s.pendingChoice = {
              type: "six-seductress",
              playerIndex: challenge.challengerPlayerIndex,
              cards: [six],
              prompt: "Number Six, Seductress — commit to give challenger +2 power?",
              context: { sixInstanceId: six.instanceId },
            };
            return; // wait for player choice
          }
        }
      }

      // Manipulate choice: prompt player before resolving undefended challenge
      if (!challenge.manipulateChecked) {
        challenge.manipulateChecked = true;
        const cDef = getCardDef(challengerStack.stack.cards[0].defId);
        const hasManipulate =
          getUndefendedEffect(cDef) === "gain-influence" ||
          getMissionKeywordGrants(
            s,
            challengerStack.stack,
            challenge.challengerPlayerIndex,
          ).includes("Manipulate" as any);
        if (hasManipulate) {
          s.pendingChoice = {
            type: "manipulate-choice",
            playerIndex: challenge.challengerPlayerIndex,
            cards: [challengerStack.stack.cards[0]],
            prompt: "Manipulate — gain influence instead of opponent losing it?",
            context: {},
          };
          return; // wait for player choice
        }
      }

      const challengerPowerContext = { phase: s.phase, isChallenger: true };
      const sixBuff = challenge.sixSeductressBuff ?? 0;
      const undefendedPower = logPowerBreakdown(
        log,
        "Challenger",
        challengerStack.stack,
        challenge.challengerPowerBuff ?? 0,
        s,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
        sixBuff ? { extraBuff: sixBuff, extraLabel: "Six Seductress" } : undefined,
      );
      if (challenge.manipulateChosen) {
        if (s.preventInfluenceGain) {
          log.push("Standoff: influence gain prevented.");
        } else {
          const before = attackerPlayer.influence;
          attackerPlayer.influence += undefendedPower;
          log.push(
            `Manipulate! ${pName(s, challenge.challengerPlayerIndex)} gains ${undefendedPower} influence. (${before} → ${attackerPlayer.influence})`,
          );
        }
      } else {
        applyInfluenceLoss(s, challenge.defenderPlayerIndex, undefendedPower, log, bases);
        log.push(`Undefended!`);
      }
      commitUnit(attackerPlayer, challenge.challengerInstanceId, log);
      challenge.resolutionComplete = true;
    } else {
      // --- DEFENDED CHALLENGE (with Starbuck reroll checkpoints) ---

      // Attacker mystic reveal (checkpoint: challengerMysticValue)
      if (challenge.challengerMysticValue === null) {
        let atkVal: number;
        const atkMystic = revealMysticValue(
          attackerPlayer,
          log,
          pName(s, challenge.challengerPlayerIndex),
        );
        atkVal = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic.value);
        // Double mystic reveal (Elosha Priestess / Channel the Lords)
        if (challenge.doubleMysticReveal === challenge.challengerPlayerIndex) {
          const atkMystic2 = revealMysticValue(
            attackerPlayer,
            log,
            `${pName(s, challenge.challengerPlayerIndex)} (double)`,
          );
          atkVal += fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic2.value);
          challenge.doubleMysticReveal = undefined; // consumed
          log.push(`Double mystic reveal total = ${atkVal}.`);
        }
        // Spot Judgment: reveal 2, pick best
        if (challenge.selfDoubleMystic === challenge.challengerPlayerIndex) {
          const atkMystic2 = revealMysticValue(
            attackerPlayer,
            log,
            `${pName(s, challenge.challengerPlayerIndex)} (Spot Judgment)`,
          );
          const val2 = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic2.value);
          atkVal = Math.max(atkVal, val2);
          challenge.selfDoubleMystic = undefined; // consumed
          log.push(`Spot Judgment: best mystic value = ${atkVal}.`);
        }
        // False Sense of Security targeting attacker
        if (challenge.opponentDoubleMystic?.opponentIndex === challenge.challengerPlayerIndex) {
          const odm = challenge.opponentDoubleMystic;
          const oppPlayer = s.players[odm.opponentIndex];
          const oppMystic2 = revealMysticValue(
            oppPlayer,
            log,
            `${pName(s, odm.opponentIndex)} (False Sense of Security)`,
          );
          const val2 = fireOnMysticReveal(s, odm.opponentIndex, oppMystic2.value);
          atkVal = Math.min(atkVal, val2);
          challenge.opponentDoubleMystic = undefined; // consumed
          log.push(`False Sense of Security: opponent's worst mystic = ${atkVal}.`);
        }
        challenge.challengerMysticValue = atkVal;
      }

      // Starbuck Risk Taker reroll for attacker
      if (!challenge.atkMysticRerollChecked) {
        challenge.atkMysticRerollChecked = true;
        const starbuck = findAlertStarbuckReroll(attackerPlayer);
        if (starbuck) {
          s.pendingChoice = {
            type: "starbuck-reroll",
            playerIndex: challenge.challengerPlayerIndex,
            cards: [starbuck],
            prompt: `Starbuck, Risk Taker — reroll mystic value ${challenge.challengerMysticValue}?`,
            context: { side: "challenger", currentValue: challenge.challengerMysticValue },
          };
          return; // wait for player choice
        }
      }

      // Defender mystic reveal (checkpoint: defenderMysticValue)
      if (challenge.defenderMysticValue === null) {
        let defVal: number;
        const defMystic = revealMysticValue(
          defenderPlayer,
          log,
          pName(s, challenge.defenderPlayerIndex),
        );
        defVal = fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic.value);
        if (challenge.doubleMysticReveal === challenge.defenderPlayerIndex) {
          const defMystic2 = revealMysticValue(
            defenderPlayer,
            log,
            `${pName(s, challenge.defenderPlayerIndex)} (double)`,
          );
          defVal += fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic2.value);
          challenge.doubleMysticReveal = undefined;
          log.push(`Double mystic reveal total = ${defVal}.`);
        }
        if (challenge.selfDoubleMystic === challenge.defenderPlayerIndex) {
          const defMystic2 = revealMysticValue(
            defenderPlayer,
            log,
            `${pName(s, challenge.defenderPlayerIndex)} (Spot Judgment)`,
          );
          const val2 = fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic2.value);
          defVal = Math.max(defVal, val2);
          challenge.selfDoubleMystic = undefined;
          log.push(`Spot Judgment: best mystic value = ${defVal}.`);
        }
        // False Sense of Security targeting defender
        if (challenge.opponentDoubleMystic?.opponentIndex === challenge.defenderPlayerIndex) {
          const odm = challenge.opponentDoubleMystic;
          const oppPlayer = s.players[odm.opponentIndex];
          const oppMystic2 = revealMysticValue(
            oppPlayer,
            log,
            `${pName(s, odm.opponentIndex)} (False Sense of Security)`,
          );
          const val2 = fireOnMysticReveal(s, odm.opponentIndex, oppMystic2.value);
          defVal = Math.min(defVal, val2);
          challenge.opponentDoubleMystic = undefined;
          log.push(`False Sense of Security: opponent's worst mystic = ${defVal}.`);
        }
        challenge.defenderMysticValue = defVal;
      }

      // Starbuck Risk Taker reroll for defender
      if (!challenge.defMysticRerollChecked) {
        challenge.defMysticRerollChecked = true;
        const starbuck = findAlertStarbuckReroll(defenderPlayer);
        if (starbuck) {
          s.pendingChoice = {
            type: "starbuck-reroll",
            playerIndex: challenge.defenderPlayerIndex,
            cards: [starbuck],
            prompt: `Starbuck, Risk Taker — reroll mystic value ${challenge.defenderMysticValue}?`,
            context: { side: "defender", currentValue: challenge.defenderMysticValue },
          };
          return; // wait for player choice
        }
      }

      // Defender-left-play: if defender left play during effects, challenge ends
      const defenderStack = findUnitInAnyZone(defenderPlayer, challenge.defenderInstanceId);
      if (!defenderStack) {
        log.push("Defender left play during challenge. Challenge ends. Challenger commits.");
        commitUnit(attackerPlayer, challenge.challengerInstanceId, log);
        s.challenge = null;
        checkVictory(s, log);
        if (s.phase !== "gameOver") {
          advanceExecutionTurn(s);
        }
        return;
      }

      // Compute final totals
      const atkMysticValue = challenge.challengerMysticValue!;
      const defMysticValue = challenge.defenderMysticValue!;

      const defenderDefForContext = getCardDef(defenderStack.stack.cards[0].defId);
      const challengerDefForContext = getCardDef(challengerStack.stack.cards[0].defId);
      const challengerPowerContext = {
        phase: s.phase,
        isChallenger: true,
        defenderDef: defenderDefForContext,
      };
      const atkTotal = logPowerBreakdown(
        log,
        "Challenger",
        challengerStack.stack,
        challenge.challengerPowerBuff ?? 0,
        s,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
        { mystic: atkMysticValue },
      );
      const defPowerContext = {
        phase: s.phase,
        isDefender: true,
        challengerDef: challengerDefForContext,
      };
      const defTotal = logPowerBreakdown(
        log,
        "Defender",
        defenderStack.stack,
        challenge.defenderPowerBuff ?? 0,
        s,
        challenge.defenderPlayerIndex,
        defPowerContext,
        { mystic: defMysticValue },
      );

      if (atkTotal >= defTotal) {
        // Challenger wins (ties go to challenger)
        log.push("Challenger wins!");
        commitUnit(attackerPlayer, challenge.challengerInstanceId, log);
        if (challenge.defenderImmune) {
          commitUnit(defenderPlayer, challenge.defenderInstanceId, log);
          log.push("Discourage Pursuit: defender is immune to defeat (committed instead).");
        } else if (challenge.losesExhaustedNotDefeated) {
          const dStack = findUnitInAnyZone(defenderPlayer, challenge.defenderInstanceId);
          if (dStack) {
            dStack.stack.exhausted = true;
            log.push("Dr. Cottle: Loser is exhausted instead of defeated.");
          }
        } else {
          defeatUnit(
            defenderPlayer,
            challenge.defenderInstanceId,
            log,
            s,
            challenge.defenderPlayerIndex,
          );
        }
        if (challenge.defeatChallengerOnWin) {
          defeatUnit(
            attackerPlayer,
            challenge.challengerInstanceId,
            log,
            s,
            challenge.challengerPlayerIndex,
          );
          log.push("Discourage Pursuit: challenger is defeated for winning.");
        }
        fireOnChallengeWin(s, challenge.challengerPlayerIndex, challenge.challengerInstanceId, log);
        fireMissionOnChallengeWinHook(
          s,
          challenge.challengerPlayerIndex,
          challengerStack.stack,
          defenderStack.stack,
          atkTotal - defTotal,
          log,
          false, // winner is the challenger (attacker)
        );
      } else {
        // Defender wins
        log.push("Defender wins!");
        commitUnit(defenderPlayer, challenge.defenderInstanceId, log);
        if (challenge.losesExhaustedNotDefeated) {
          const aStack = findUnitInAnyZone(attackerPlayer, challenge.challengerInstanceId);
          if (aStack) {
            aStack.stack.exhausted = true;
            log.push("Dr. Cottle: Loser is exhausted instead of defeated.");
          }
        } else {
          defeatUnit(
            attackerPlayer,
            challenge.challengerInstanceId,
            log,
            s,
            challenge.challengerPlayerIndex,
          );
        }
        fireOnChallengeWin(s, challenge.defenderPlayerIndex, challenge.defenderInstanceId!, log);
        fireMissionOnChallengeWinHook(
          s,
          challenge.defenderPlayerIndex,
          defenderStack.stack,
          challengerStack.stack,
          defTotal - atkTotal,
          log,
          true, // winner is the defender
        );
      }
      challenge.resolutionComplete = true;
    }
  }

  // ============= CLEANUP PHASE =============

  // Fire challenge-end triggers (mandatory: Centurion/Skirmishing; optional: Gaeta/Helo)
  if (!challenge.challengeEndTriggersChecked) {
    challenge.challengeEndTriggersChecked = true;
    fireOnChallengeEnd(s, challenge, log);
    if (s.pendingChoice) return; // optional trigger needs player decision
  }

  // Tigh XO: commit+exhaust at end (only if readied during this challenge)
  if (challenge.tighXoReadied) {
    const dp = s.players[challenge.defenderPlayerIndex];
    const tighFound = findUnitInAnyZone(dp, challenge.tighXoReadied);
    if (tighFound) {
      if (tighFound.zone === "alert") {
        commitUnit(dp, challenge.tighXoReadied, log);
      }
      const f2 = findUnitInAnyZone(dp, challenge.tighXoReadied);
      if (f2) f2.stack.exhausted = true;
      log.push("Saul Tigh commits and exhausts after challenge.");
    }
  }

  // Agro Ship / Flattop: commit the readied unit at end of challenge
  if (s.challenge!.triggerReadiedInstanceId) {
    const triggerOwner = s.players[s.challenge!.defenderPlayerIndex];
    const readiedId = s.challenge!.triggerReadiedInstanceId;
    const readiedUnitFound = findUnitInAnyZone(triggerOwner, readiedId);
    if (readiedUnitFound && readiedUnitFound.zone === "alert") {
      commitUnit(triggerOwner, readiedId, log);
      log.push("Triggered unit commits at end of challenge.");
    }
  }

  // Stims: exhaust unit at challenge end
  if (challenge.exhaustAtChallengeEnd) {
    for (const p of s.players) {
      const found = findUnitInAnyZone(p, challenge.exhaustAtChallengeEnd);
      if (found) {
        found.stack.exhausted = true;
        log.push("Stims wears off: unit is exhausted.");
        break;
      }
    }
  }

  // Unwelcome Visitor: defeat unit at challenge end
  if (challenge.defeatAtChallengeEnd) {
    for (let pi = 0; pi < s.players.length; pi++) {
      const found = findUnitInAnyZone(s.players[pi], challenge.defeatAtChallengeEnd);
      if (found) {
        defeatUnit(s.players[pi], challenge.defeatAtChallengeEnd, log, s, pi);
        log.push("Unwelcome Visitor: unit is defeated.");
        break;
      }
    }
  }

  log.push({ msg: "Challenge ends.", d: 0, cat: "flow" });
  s.challenge = null;
  checkVictory(s, log);
  if (s.phase !== "gameOver") {
    advanceExecutionTurn(s);
  }
}

function resolveCylonChallenge(
  s: GameState,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  const challenge = s.challenge!;
  const attackerPlayer = s.players[challenge.challengerPlayerIndex];
  const cylonPlayer = s.players[challenge.cylonPlayerIndex!];

  const challengerStack = findUnitInAnyZone(attackerPlayer, challenge.challengerInstanceId);
  if (!challengerStack) {
    log.push("Challenger left play. Cylon challenge ends.");
    s.challenge = null;
    return;
  }

  const cylonChallengerCtx = { phase: "cylon" as const, isChallenger: true };

  // Reveal mystic values (with hooks)
  const atkMystic = revealMysticValue(
    attackerPlayer,
    log,
    pName(s, challenge.challengerPlayerIndex),
  );
  const atkMysticValue = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic.value);
  const defMystic = revealMysticValue(
    cylonPlayer,
    log,
    `${pName(s, challenge.cylonPlayerIndex!)} (Cylon player)`,
  );

  const threatIdx = challenge.cylonThreatIndex!;
  const threat = s.cylonThreats[threatIdx];
  if (!threat) {
    s.challenge = null;
    return;
  }

  const atkTotal = logPowerBreakdown(
    log,
    "Challenger",
    challengerStack.stack,
    challenge.challengerPowerBuff ?? 0,
    s,
    challenge.challengerPlayerIndex,
    cylonChallengerCtx,
    { mystic: atkMysticValue },
  );
  const defTotal = threat.power + defMystic.value;
  log.push({
    msg: `Cylon threat: power ${threat.power} + mystic ${defMystic.value} = ${defTotal}`,
    d: 2,
    cat: "power",
  });

  if (atkTotal >= defTotal) {
    log.push("Challenger defeats the Cylon threat!");
    // Gain influence (2 in 2-player, 1 in 3+ player)
    const gain = s.players.length === 2 ? 2 : 1;
    if (s.preventInfluenceGain) {
      log.push("Standoff: influence gain prevented.");
    } else {
      const before = attackerPlayer.influence;
      attackerPlayer.influence += gain;
      log.push(
        `${pName(s, challenge.challengerPlayerIndex)} gains ${gain} influence. (${before} → ${attackerPlayer.influence})`,
      );
    }
    commitUnit(attackerPlayer, challenge.challengerInstanceId, log);
    // Fire onChallengeWin triggers (e.g., Nuclear-Armed Raider)
    fireOnChallengeWin(s, challenge.challengerPlayerIndex, challenge.challengerInstanceId, log);
    // Fire mission Cylon defeat triggers (Nothin' But The Rain: +1 influence)
    fireMissionOnCylonDefeat(
      s,
      challenge.challengerPlayerIndex,
      challenge.challengerInstanceId,
      log,
    );
    // Put threat into owner's discard
    s.players[threat.ownerIndex].discard.push(threat.card);
    s.cylonThreats.splice(threatIdx, 1);
  } else {
    log.push("Cylon threat wins!");
    defeatUnit(
      attackerPlayer,
      challenge.challengerInstanceId,
      log,
      s,
      challenge.challengerPlayerIndex,
    );
    // Threat remains
  }

  // Fire challenge-end triggers for Cylon challenges too
  if (s.challenge) {
    fireOnChallengeEnd(s, challenge, log);
  }

  s.challenge = null;

  // Reset passes for continuing Cylon phase
  for (const p of s.players) {
    p.consecutivePasses = 0;
  }

  checkVictory(s, log);
  if (s.phase !== "gameOver") {
    if (s.cylonThreats.length === 0) {
      endCylonPhase(s, log, bases);
    } else {
      // Continue Cylon phase from next player
      advanceCylonTurn(s);
    }
  }
}

// ============================================================
// Unit Helpers
// ============================================================

/** Get all valid link targets for a Link mission (instance IDs). */
function getValidLinkTargets(
  player: PlayerState,
  linkType: "personnel" | "ship" | "unit" | undefined,
): string[] {
  const targets: string[] = [];
  for (const zone of [player.zones.alert, player.zones.reserve]) {
    for (const stack of zone) {
      const top = stack.cards[0];
      if (!top?.faceUp) continue;
      const def = getCardDef(top.defId);
      if (!isUnit(def)) continue;
      if (linkType === "personnel" && def.type !== "personnel") continue;
      if (linkType === "ship" && def.type !== "ship") continue;
      targets.push(top.instanceId);
    }
  }
  return targets;
}

/** Pick best link target for a Link mission (AI: highest power matching unit in alert). */
function pickLinkTarget(
  player: PlayerState,
  linkType: "personnel" | "ship" | "unit" | undefined,
  _missionDef: CardDef,
): UnitStack | null {
  let best: UnitStack | null = null;
  let bestPower = -1;
  for (const stack of player.zones.alert) {
    const top = stack.cards[0];
    if (!top?.faceUp || stack.exhausted) continue;
    const def = getCardDef(top.defId);
    if (!isUnit(def)) continue;
    if (linkType === "personnel" && def.type !== "personnel") continue;
    if (linkType === "ship" && def.type !== "ship") continue;
    // "unit" accepts both personnel and ship
    const power = def.power ?? 0;
    if (power > bestPower) {
      bestPower = power;
      best = stack;
    }
  }
  // Also check reserve if no alert target found
  if (!best) {
    for (const stack of player.zones.reserve) {
      const top = stack.cards[0];
      if (!top?.faceUp) continue;
      const def = getCardDef(top.defId);
      if (!isUnit(def)) continue;
      if (linkType === "personnel" && def.type !== "personnel") continue;
      if (linkType === "ship" && def.type !== "ship") continue;
      const power = def.power ?? 0;
      if (power > bestPower) {
        bestPower = power;
        best = stack;
      }
    }
  }
  return best;
}

function findUnitInAnyZone(
  player: PlayerState,
  instanceId: string,
): { stack: UnitStack; zone: "alert" | "reserve"; index: number } | null {
  for (let i = 0; i < player.zones.alert.length; i++) {
    if (player.zones.alert[i].cards[0]?.instanceId === instanceId) {
      return { stack: player.zones.alert[i], zone: "alert", index: i };
    }
  }
  for (let i = 0; i < player.zones.reserve.length; i++) {
    if (player.zones.reserve[i].cards[0]?.instanceId === instanceId) {
      return { stack: player.zones.reserve[i], zone: "reserve", index: i };
    }
  }
  return null;
}

function findUnitStackByInstanceId(s: GameState, instanceId: string): UnitStack | null {
  for (const p of s.players) {
    const found = findUnitInAnyZone(p, instanceId);
    if (found) return found.stack;
  }
  return null;
}

function commitUnit(player: PlayerState, instanceId: string, log?: LogItem[]): void {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && found.zone === "alert") {
    player.zones.alert.splice(found.index, 1);
    player.zones.reserve.push(found.stack);
    if (log) {
      const def = getCardDef(found.stack.cards[0].defId);
      log.push(`${def ? cardName(def) : "Unit"} committed.`);
    }
  }
}

function defeatUnit(
  player: PlayerState,
  instanceId: string,
  log: LogItem[],
  state?: GameState,
  playerIndex?: number,
): void {
  const found = findUnitInAnyZone(player, instanceId);
  if (found) {
    const def = getCardDef(found.stack.cards[0].defId);
    // Mission defeat interception (Flight School, Misdirection, Beyond Insane)
    if (state && playerIndex !== undefined) {
      const unitType = def.type === "ship" ? "ship" : "personnel";
      if (interceptMissionDefeat(state, playerIndex, unitType, instanceId, log)) {
        return; // defeat prevented by mission sacrifice
      }
    }
    // Fire onDefeat trigger before moving to discard
    if (state && playerIndex !== undefined) {
      fireOnDefeat(state, playerIndex, def, instanceId, log);
    }
    log.push(`${cardName(def)} is defeated.`);
    // Cleanup linked missions before removing the unit
    if (state && playerIndex !== undefined) {
      cleanupLinkedMissions(state, playerIndex, found.stack, log);
    }
    const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
    zone.splice(found.index, 1);
    for (const card of found.stack.cards) {
      player.discard.push(card);
    }
  }
}

function payResourceCost(
  player: PlayerState,
  cost: CardCost,
  bases: Record<string, BaseCardDef>,
  log?: LogItem[],
): Record<ResourceType, number> {
  const excess: Record<ResourceType, number> = { persuasion: 0, logistics: 0, security: 0 };
  if (!cost) return excess;

  // Ragnar Anchorage override: logistics ≥2 generates 3 of any one resource type
  if (player.ragnarResourceOverride) {
    const costEntries = Object.entries(cost) as [ResourceType, number][];
    if (costEntries.length === 1 && costEntries[0][1] <= 3) {
      // Try to pay with a logistics stack that generates ≥ 2
      for (const stack of player.zones.resourceStacks) {
        if (stack.exhausted) continue;
        if (getStackResourceTypeFromPlayer(stack, bases, player) === "logistics") {
          if (stackResourceCount(stack) >= 2) {
            stack.exhausted = true;
            player.ragnarResourceOverride = false;
            // Ragnar generates 3 of any type; excess = 3 - cost
            excess[costEntries[0][0]] = 3 - costEntries[0][1];
            return excess;
          }
        }
      }
    }
    // If override wasn't used, clear it anyway (one-shot)
    player.ragnarResourceOverride = false;
  }

  let anyStackSpent = false;
  for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
    let remaining = amount;
    for (const stack of player.zones.resourceStacks) {
      if (remaining <= 0) break;
      if (stack.exhausted) continue;
      if (getStackResourceTypeFromPlayer(stack, bases, player) === resType) {
        stack.exhausted = true;
        remaining -= stackResourceCount(stack);
        anyStackSpent = true;
      }
    }
    // Freighter bonus: commit freighters to cover remaining cost
    if (remaining > 0 && anyStackSpent) {
      remaining = commitFreightersForResource(player, resType as ResourceType, remaining, log);
    }
    // Track excess (negative remaining = excess)
    if (remaining < 0) {
      excess[resType as ResourceType] = Math.abs(remaining);
    }
  }
  // Log the cost that was paid
  if (log) {
    const parts = (Object.entries(cost) as [ResourceType, number][])
      .filter(([, amt]) => amt > 0)
      .map(([res, amt]) => `${amt} ${res}`);
    if (parts.length > 0) {
      log.push(`(Paid ${parts.join(", ")})`);
    }
  }
  return excess;
}

/** Validate that a player's resource stack selection is legal for the given cost. */
function validateStackSelection(
  player: PlayerState,
  cost: CardCost,
  bases: Record<string, BaseCardDef>,
  selectedStackIndices: number[],
): boolean {
  if (!cost) return selectedStackIndices.length === 0;

  // Check: all indices valid, not exhausted, no duplicates
  const seen = new Set<number>();
  for (const idx of selectedStackIndices) {
    if (idx < 0 || idx >= player.zones.resourceStacks.length) return false;
    if (player.zones.resourceStacks[idx].exhausted) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
  }

  // Tally resources by type from selected stacks
  const provided: Record<string, number> = {};
  for (const idx of selectedStackIndices) {
    const stack = player.zones.resourceStacks[idx];
    const resType = getStackResourceTypeFromPlayer(stack, bases, player);
    if (!resType) return false;
    provided[resType] = (provided[resType] ?? 0) + stackResourceCount(stack);
  }

  // Include freighter bonuses (conditional on at least one stack being spent)
  if (selectedStackIndices.length > 0) {
    for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
      if ((provided[resType] ?? 0) < amount) {
        provided[resType] = (provided[resType] ?? 0) + countFreighterBonus(player, resType);
      }
    }
  }

  // Check each resource type is met
  for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
    if ((provided[resType] ?? 0) < amount) return false;
  }

  // Enforce "if one stack covers the cost, can't spend more" —
  // no unnecessary stacks: removing any one selected stack of a type should make cost unmet
  for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
    const stacksOfType = selectedStackIndices.filter((idx) => {
      const stack = player.zones.resourceStacks[idx];
      return getStackResourceTypeFromPlayer(stack, bases, player) === resType;
    });
    for (const removeIdx of stacksOfType) {
      const withoutThis =
        (provided[resType] ?? 0) - stackResourceCount(player.zones.resourceStacks[removeIdx]);
      if (withoutThis >= amount) {
        return false; // This stack is unnecessary
      }
    }
  }

  return true;
}

/** Pay resource cost using player-specified stack indices (instead of auto-selection). */
function payResourceCostWithSelection(
  player: PlayerState,
  cost: CardCost,
  bases: Record<string, BaseCardDef>,
  selectedStackIndices: number[],
  log?: LogItem[],
): Record<ResourceType, number> {
  const excess: Record<ResourceType, number> = { persuasion: 0, logistics: 0, security: 0 };
  if (!cost) return excess;

  // Ragnar Anchorage override uses its own logic (always picks best logistics stack)
  if (player.ragnarResourceOverride) {
    const costEntries = Object.entries(cost) as [ResourceType, number][];
    if (costEntries.length === 1 && costEntries[0][1] <= 3) {
      for (const stack of player.zones.resourceStacks) {
        if (stack.exhausted) continue;
        if (getStackResourceTypeFromPlayer(stack, bases, player) === "logistics") {
          if (stackResourceCount(stack) >= 2) {
            stack.exhausted = true;
            player.ragnarResourceOverride = false;
            excess[costEntries[0][0]] = 3 - costEntries[0][1];
            return excess;
          }
        }
      }
    }
    player.ragnarResourceOverride = false;
  }

  // Exhaust the player-selected stacks and tally remaining cost
  const remaining: Record<ResourceType, number> = { persuasion: 0, logistics: 0, security: 0 };
  for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
    remaining[resType] = amount;
  }
  let anyStackSpent = false;

  for (const idx of selectedStackIndices) {
    const stack = player.zones.resourceStacks[idx];
    if (!stack || stack.exhausted) continue;
    const resType = getStackResourceTypeFromPlayer(stack, bases, player) as ResourceType;
    if (!resType || remaining[resType] <= 0) continue;
    stack.exhausted = true;
    remaining[resType] -= stackResourceCount(stack);
    anyStackSpent = true;
  }

  // Freighter bonus for any remaining cost
  for (const [resType, rem] of Object.entries(remaining) as [ResourceType, number][]) {
    if (rem > 0 && anyStackSpent) {
      remaining[resType] = commitFreightersForResource(player, resType, rem, log);
    }
  }

  // Track excess (negative remaining = excess)
  for (const [resType, rem] of Object.entries(remaining) as [ResourceType, number][]) {
    if (rem < 0) {
      excess[resType] = Math.abs(rem);
    }
  }

  // Log
  if (log) {
    const parts = (Object.entries(cost) as [ResourceType, number][])
      .filter(([, amt]) => amt > 0)
      .map(([res, amt]) => `${amt} ${res}`);
    if (parts.length > 0) {
      log.push(`(Paid ${parts.join(", ")})`);
    }
  }
  return excess;
}

// Freighter resource type mapping moved to unit-abilities.ts (freighterResource hook).

/** Commit alert freighters to generate their resource type, reducing remaining cost. */
function commitFreightersForResource(
  player: PlayerState,
  resType: ResourceType,
  remaining: number,
  log?: LogItem[],
): number {
  for (let i = player.zones.alert.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const stack = player.zones.alert[i];
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (!def.abilityId || getFreighterResource(def.abilityId) !== resType) continue;
    // Commit the freighter (move from alert to reserve)
    player.zones.alert.splice(i, 1);
    player.zones.reserve.push(stack);
    remaining--;
    log?.push(`${cardName(def)}: committed to generate ${resType}.`);
  }
  return remaining;
}

/** Count how many alert freighters can generate the given resource type (for affordability checks). */
function countFreighterBonus(player: PlayerState, resType: ResourceType): number {
  let count = 0;
  for (const stack of player.zones.alert) {
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (def.abilityId && getFreighterResource(def.abilityId) === resType) {
      count++;
    }
  }
  return count;
}

/** Count all alert freighters of any type (for "any resource" affordability checks). */
function countAllFreighters(player: PlayerState): number {
  let count = 0;
  for (const stack of player.zones.alert) {
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (def.abilityId && getFreighterResource(def.abilityId)) {
      count++;
    }
  }
  return count;
}

/** Spend N resource stacks of any type (Difference of Opinion challenge cost). Prefers smallest stacks. */
function spendAnyResources(player: PlayerState, count: number, log: LogItem[]): void {
  const available = player.zones.resourceStacks
    .filter((s) => !s.exhausted)
    .sort((a, b) => stackResourceCount(a) - stackResourceCount(b));
  let remaining = count;
  for (const stack of available) {
    if (remaining <= 0) break;
    stack.exhausted = true;
    remaining--;
  }
  // Freighters can cover remaining cost (each generates 1 resource of any type)
  if (remaining > 0) {
    for (let i = player.zones.alert.length - 1; i >= 0; i--) {
      if (remaining <= 0) break;
      const stack = player.zones.alert[i];
      if (stack.exhausted) continue;
      const topCard = stack.cards[0];
      if (!topCard?.faceUp) continue;
      const def = getCardDef(topCard.defId);
      const freighterRes = def.abilityId ? getFreighterResource(def.abilityId) : undefined;
      if (!freighterRes) continue;
      player.zones.alert.splice(i, 1);
      player.zones.reserve.push(stack);
      remaining--;
      log.push(`${cardName(def)}: committed to generate ${freighterRes}.`);
    }
  }
  if (count > 0) {
    log.push(`Paid ${count} resource(s) for challenge cost (Difference of Opinion).`);
  }
}

function resetConsecutivePasses(s: GameState): void {
  for (const p of s.players) {
    p.consecutivePasses = 0;
  }
}

/** Commit alert units with interceptInfluenceLoss hook to reduce influence loss. */
function interceptUnitInfluenceLoss(
  s: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
): number {
  if (amount <= 0) return amount;
  const player = s.players[playerIndex];
  for (const stack of player.zones.alert) {
    if (amount <= 0) break;
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (!def.abilityId || !canInterceptInfluenceLoss(def.abilityId)) continue;
    commitUnit(player, topCard.instanceId, log);
    amount = Math.max(0, amount - 1);
    log.push(`${cardName(def)}: reduces influence loss by 1.`);
  }
  return amount;
}

/** Apply influence loss with prevention check and I.H.T. Colonial One interception. */
function applyInfluenceLoss(
  s: GameState,
  playerIndex: number,
  amount: number,
  log: LogItem[],
  bases: Record<string, BaseCardDef>,
): void {
  if (s.preventInfluenceLoss) {
    log.push("Executive Privilege: influence loss prevented.");
    return;
  }
  let adjusted = interceptInfluenceLoss(s, playerIndex, amount, log, bases);
  // Cloud 9, Cruise Ship: commit to reduce influence loss by 1
  if (adjusted > 0) {
    adjusted = interceptUnitInfluenceLoss(s, playerIndex, adjusted, log);
  }
  if (adjusted > 0) {
    const before = s.players[playerIndex].influence;
    s.players[playerIndex].influence -= adjusted;
    log.push(
      `${pName(s, playerIndex)} loses ${adjusted} influence. (${before} → ${s.players[playerIndex].influence})`,
    );
  }
}

/** Resolve a pending choice by type — dispatches to pending-choice-registry. */
function resolvePendingChoice(
  s: GameState,
  choice: NonNullable<GameState["pendingChoice"]>,
  choiceIndex: number,
  player: PlayerState,
  playerIndex: number,
  log: LogItem[],
  _bases: Record<string, BaseCardDef>,
): void {
  if (dispatchResolvePendingChoice(s, choiceIndex, player, playerIndex, log)) {
    return;
  }
  log.push(`(Unhandled pending choice type: "${choice.type}")`);
}

/** Get valid actions for a pending choice — dispatches to pending-choice-registry. */
function getPendingChoiceActions(state: GameState): ValidAction[] {
  const choice = state.pendingChoice;
  if (!choice) return [];
  const registered = dispatchGetPendingChoiceActions(state);
  if (registered !== null) return registered;
  return [];
}

// Legacy switches removed — all 33 cases migrated to registerPendingChoice() calls in:
// base-abilities.ts, unit-abilities.ts, event-abilities.ts, mission-abilities.ts

function advanceChallengeEffectTurn(s: GameState): void {
  if (!s.challenge) return;
  s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
}

// ============================================================
// Effect Resolution
// ============================================================

// Power buffs tracked ephemerally on the challenge state
interface ChallengeWithBuffs extends ChallengeState {
  challengerPowerBuff?: number;
  defenderPowerBuff?: number;
}

function applyPowerBuff(
  s: GameState,
  targetInstanceId: string,
  amount: number,
  log: LogItem[],
): void {
  // Effect immunity: "power" or "all" blocks power changes
  if (s.effectImmunity?.[targetInstanceId]) {
    log.push("Effect blocked — target unit is immune to power changes.");
    return;
  }
  // If we're in a challenge, apply as a buff to the challenge
  if (s.challenge) {
    const c = s.challenge as ChallengeWithBuffs;
    if (c.challengerInstanceId === targetInstanceId) {
      c.challengerPowerBuff = (c.challengerPowerBuff ?? 0) + amount;
      const tDef = findCardDefByInstanceId(s, targetInstanceId);
      const tName = tDef ? cardName(tDef) : "Challenger";
      log.push(`${tName} gets ${amount >= 0 ? "+" : ""}${amount} power.`);
    } else if (c.defenderInstanceId === targetInstanceId) {
      c.defenderPowerBuff = (c.defenderPowerBuff ?? 0) + amount;
      const tDef = findCardDefByInstanceId(s, targetInstanceId);
      const tName = tDef ? cardName(tDef) : "Defender";
      log.push(`${tName} gets ${amount >= 0 ? "+" : ""}${amount} power.`);
    }
  }
  // Outside of challenge, apply persistent buff to the unit stack (lasts until end of execution)
  if (!s.challenge) {
    const stack = findUnitStackByInstanceId(s, targetInstanceId);
    if (stack) {
      stack.powerBuff = (stack.powerBuff ?? 0) + amount;
      const topDef = getCardDef(stack.cards[0].defId);
      log.push(`${cardName(topDef)} gets ${amount >= 0 ? "+" : ""}${amount} power.`);
    }
  }
}

function resolveEventEffect(
  s: GameState,
  playerIndex: number,
  def: CardDef,
  log: LogItem[],
  targetInstanceId: string | undefined,
): void {
  if (def.abilityId) {
    resolveEventAbility(def.abilityId, s, playerIndex, targetInstanceId, log);
  } else {
    log.push(`Event ${cardName(def)} resolved (no effect).`);
  }
}

function resolveMissionEffect(
  s: GameState,
  playerIndex: number,
  def: CardDef,
  log: LogItem[],
  targetInstanceId?: string,
): void {
  if (def.abilityId) {
    resolveMissionAbility(def.abilityId, s, playerIndex, targetInstanceId, log);
  } else {
    log.push(`Mission ${cardName(def)} resolved (no effect).`);
  }
}

// ============================================================
// Victory Check
// ============================================================

function checkVictory(s: GameState, log: LogItem[]): void {
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].influence >= 20) {
      s.phase = "gameOver";
      s.winner = i;
      log.push(`${s.playerNames[i as 0 | 1]} wins! Influence reached ${s.players[i].influence}.`);
      return;
    }
  }
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].influence <= 0) {
      s.phase = "gameOver";
      s.winner = 1 - i;
      log.push(
        `${s.playerNames[i as 0 | 1]} loses! Influence dropped to ${s.players[i].influence}. ${s.playerNames[(1 - i) as 0 | 1]} wins!`,
      );
      return;
    }
  }
}

// ============================================================
// Expedite Pending Choice Handler
// ============================================================

registerPendingChoice("fleet-jump-sacrifice", {
  getActions(choice, state) {
    const actions: ValidAction[] = [];
    const player = state.players[choice.playerIndex];
    for (const card of choice.cards) {
      // Determine if this is an asset or supply card
      const isAsset = player.zones.resourceStacks.some(
        (stack, si) => si > 0 && stack.topCard.instanceId === card.instanceId,
      );
      if (isAsset) {
        const def = getCardDef(card.defId);
        actions.push({
          type: "makeChoice" as const,
          description: `Sacrifice asset: ${cardName(def)}`,
          cardDefId: def.id,
        });
      } else {
        // Supply card — find which stack it belongs to for the label + badge
        let stackLabel = "supply card";
        let stackDefId: string | undefined;
        for (const stack of player.zones.resourceStacks) {
          if (stack.supplyCards.some((sc) => sc.instanceId === card.instanceId)) {
            stackDefId = stack.topCard.defId;
            const si = player.zones.resourceStacks.indexOf(stack);
            if (si === 0) {
              const baseDef = getHelpers().bases[player.baseDefId];
              stackLabel = `supply card under ${baseDef?.title ?? "base"}`;
            } else {
              const assetDef = getCardDef(stack.topCard.defId);
              stackLabel = `supply card under ${cardName(assetDef)}`;
            }
            break;
          }
        }
        actions.push({
          type: "makeChoice" as const,
          description: `Sacrifice ${stackLabel}`,
          cardDefId: stackDefId,
        });
      }
    }
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    const chosenCard = choice.cards[choiceIndex];

    // Try to find as asset (non-base resource stack)
    let found = false;
    for (let si = 1; si < player.zones.resourceStacks.length; si++) {
      if (player.zones.resourceStacks[si].topCard.instanceId === chosenCard.instanceId) {
        const removed = player.zones.resourceStacks.splice(si, 1)[0];
        player.discard.push(removed.topCard);
        for (const sc of removed.supplyCards) player.discard.push(sc);
        const def = getCardDef(removed.topCard.defId);
        log.push(`${pName(state, playerIndex)} sacrifices asset ${cardName(def)}.`);
        found = true;
        break;
      }
    }

    // Try as supply card
    if (!found) {
      for (const stack of player.zones.resourceStacks) {
        const idx = stack.supplyCards.findIndex((c) => c.instanceId === chosenCard.instanceId);
        if (idx !== -1) {
          const supply = stack.supplyCards.splice(idx, 1)[0];
          player.discard.push(supply);
          log.push(`${pName(state, playerIndex)} sacrifices a supply card.`);
          found = true;
          break;
        }
      }
    }

    // Chaining is handled by the makeChoice handler in applyAction,
    // which checks fleetJumpPending and calls setupFleetJumpSacrifice for the next player.
  },
  aiDecide(choice, _choiceActions, state, playerIndex) {
    const player = state.players[playerIndex];
    // AI: sacrifice cheapest asset first, then supply card
    // Prefer bare assets (no supply cards) to preserve resources
    let bestIdx = 0;
    let bestIsAsset = false;
    for (let i = 0; i < choice.cards.length; i++) {
      const card = choice.cards[i];
      const isAsset = player.zones.resourceStacks.some(
        (stack, si) => si > 0 && stack.topCard.instanceId === card.instanceId,
      );
      if (isAsset && !bestIsAsset) {
        bestIdx = i;
        bestIsAsset = true;
      }
    }
    return bestIdx;
  },
});

registerPendingChoice("expedite-choice", {
  getActions(choice) {
    const actions: ValidAction[] = [];
    for (const card of choice.cards) {
      const def = getCardDef(card.defId);
      actions.push({
        type: "makeChoice" as const,
        description: `Expedite: play ${cardName(def)}`,
        cardDefId: def.id,
      });
    }
    actions.push({ type: "makeChoice" as const, description: "Skip Expedite" });
    return actions;
  },
  resolve(choice, choiceIndex, state, player, playerIndex, log) {
    // Last option is "Skip"
    if (choiceIndex >= choice.cards.length) {
      log.push(`${pName(state, playerIndex)} skips Expedite.`);
      return;
    }

    const expCard = choice.cards[choiceIndex];
    const expDef = getCardDef(expCard.defId);
    const pLabel = state.playerNames[playerIndex as 0 | 1];

    // Remove from hand
    const handIdx = player.hand.findIndex((c) => c.instanceId === expCard.instanceId);
    if (handIdx < 0) return;
    player.hand.splice(handIdx, 1);

    log.push(`Expedite! ${pLabel} plays ${cardName(expDef)} using excess resources.`);

    if (isUnit(expDef) || isMission(expDef)) {
      const expOverlay =
        isUnit(expDef) &&
        isSingular(expDef) &&
        !checkMissionOverlayPrevention(state, playerIndex, expDef)
          ? findOverlayTarget(player, expDef)
          : null;
      if (expOverlay) {
        expOverlay.stack.cards.unshift(expCard);
        expOverlay.stack.exhausted = false;
        log.push(`${pLabel} overlays ${cardName(expDef)} (Expedite).`);
      } else {
        player.zones.reserve.push({ cards: [expCard], exhausted: false });
      }
      if (isUnit(expDef)) {
        fireOnEnterPlay(state, playerIndex, expDef, expCard.instanceId, log);
        if (expDef.type === "ship")
          fireOnShipEnterPlay(state, playerIndex, expCard.instanceId, log);
      }
    } else if (expDef.type === "event") {
      resolveEventEffect(state, playerIndex, expDef, log, undefined);
      if (!state.skipEventDiscard) player.discard.push(expCard);
      state.skipEventDiscard = undefined;
      fireMissionOnEventPlay(state, playerIndex, log);
    }
  },
  aiDecide(_choice, choiceActions) {
    // AI always plays the first eligible Expedite card
    return 0;
  },
});
