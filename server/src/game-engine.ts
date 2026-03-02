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
  setBaseAbilityCardRegistry,
} from "./base-abilities.js";
import {
  getUnitAbilityActions,
  resolveUnitAbility,
  getUnitAbilityCost,
  canUnitAbilityChallenge,
  computePassivePowerModifier,
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
} from "./unit-abilities.js";
import {
  resolveEventAbility,
  canPlayEvent,
  isEventPlayableIn,
  setEventGameHelpers,
  setEventAbilityCardRegistry,
} from "./event-abilities.js";
import {
  resolveMissionAbility,
  getMissionCategory,
  getLinkTargetType,
  computeMissionPowerModifier,
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
  setMissionAbilityCardRegistry,
  setMissionGameHelpers,
} from "./mission-abilities.js";
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
    revealMysticValue(state: GameState, playerIndex: number, log: string[]): number {
      const player = state.players[playerIndex];
      const result = revealMysticValue(player, log, `Player ${playerIndex + 1}`);
      return result.value;
    },
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

const resourceAbbrev: Record<ResourceType, string> = {
  persuasion: "P",
  logistics: "L",
  security: "S",
};

function formatCost(cost: CardCost): string {
  if (!cost) return "";
  return (Object.entries(cost) as [ResourceType, number][])
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n}${resourceAbbrev[r]}`)
    .join(" ");
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
  log: string[],
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

function revealMysticValue(
  player: PlayerState,
  log: string[],
  playerLabel: string,
): { value: number; card: CardInstance } {
  if (player.deck.length === 0) {
    if (player.discard.length === 0) {
      return { value: 0, card: makeCardInstance("condition-one") };
    }
    player.deck = [...player.discard];
    player.discard = [];
    shuffle(player.deck);
    log.push(`${playerLabel} reshuffled discard pile into deck.`);
  }
  const card = player.deck.shift()!;
  const def = getCardDef(card.defId);
  log.push(`${playerLabel} reveals ${cardName(def)} (mystic value ${def.mysticValue ?? 0}).`);
  player.discard.push(card);
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

// --- Get power of top card in a unit stack ---

function getUnitPower(stack: UnitStack): number {
  const topCard = stack.cards[0];
  if (!topCard) return 0;
  return getCardDef(topCard.defId).power ?? 0;
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

function stampLog(entries: string[]): string[] {
  const ts = timestamp();
  return entries.map((e) => `${ts} ${e}`);
}

// ============================================================
// Create Game
// ============================================================

export function createGame(
  base1: BaseCardDef,
  deck1: string[],
  base2: BaseCardDef,
  deck2: string[],
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

  // Draw starting hands
  const log: string[] = [];
  drawCards(p1, base1.handSize, log, "Player 1");
  drawCards(p2, base2.handSize, log, "Player 2");
  log.push("Game created. Players may choose to keep or redraw their hands.");

  const state: GameState = {
    players: [p1, p2],
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
        const resourceLabel = def.resource
          ? def.resource.charAt(0).toUpperCase() + def.resource.slice(1)
          : null;
        actions.push({
          type: "playToResource",
          description: resourceLabel
            ? `${cardName(def)} — ${resourceLabel}`
            : `${cardName(def)} — supply only`,
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
      const costStr = formatCost(def.cost);
      const typeLabel = def.type.charAt(0).toUpperCase() + def.type.slice(1);
      const affordable = canAfford(player, def, bases);
      // Targeted events with no valid targets are not playable
      if (
        def.type === "event" &&
        def.abilityId &&
        !canPlayEvent(def.abilityId, state, playerIndex, "execution")
      ) {
        continue;
      }
      actions.push({
        type: "playCard",
        description: `${cardName(def)} — ${typeLabel}${costStr ? ` (${costStr})` : ""}`,
        cardDefId: def.id,
        selectableCardIndices: [i],
        ...(affordable ? {} : { disabled: true }),
      });
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
            description: `Challenge with ${unitLabel}${costSuffix}`,
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
              actions.push({
                type: "resolveMission",
                description: `Resolve ${cardName(def)}: ${def.abilityText}`,
                cardDefId: def.id,
                selectableInstanceIds: [topCard.instanceId],
              });
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
        description: "Challenge a Cylon threat",
        selectableInstanceIds: units,
        selectableThreatIndices: state.cylonThreats.map((_, i) => i),
      });
    }
    actions.push({ type: "passCylon", description: "Pass (lose 1 influence)" });
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

  // Pending triggered ability (Agro Ship / Flattop) — before defender selection
  if (challenge.pendingTrigger) {
    if (playerIndex === challenge.pendingTrigger.playerIndex) {
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
      actions.push({ type: "declineTrigger", description: "Decline" });
      return actions;
    }
    return actions; // other player waits
  }

  // Waiting for defender choice
  if (challenge.waitingForDefender) {
    // Determine who is selecting the defender (Sniper → challenger picks)
    const selectorPlayerIndex =
      challenge.defenderSelector === "challenger"
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
              const label =
                challenge.defenderSelector === "challenger"
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
          if (handDef.abilityId === "raptor432-flash" && canAfford(player, handDef, bases)) {
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

      actions.push({ type: "defend", description: "Decline to defend" });
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
        actions.push({
          type: "playEventInChallenge",
          description: `${cardName(def)} — Event${formatCost(def.cost) ? ` (${formatCost(def.cost)})` : ""}`,
          cardDefId: def.id,
          selectableCardIndices: [i],
        });
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
    // Count alert freighters that generate this resource type
    if (available < effectiveAmount) {
      available += countFreighterBonus(player, resType as ResourceType);
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

    // Check Colonial Heavy 798 for Civilian requirements
    if (satisfied < req.count && req.label.toLowerCase().includes("civilian") && bases) {
      const baseDef = bases[player.baseDefId];
      if (baseDef?.abilityId === "colonial-heavy-798") {
        const baseStack = player.zones.resourceStacks[0];
        if (baseStack && !baseStack.exhausted) {
          satisfied++;
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
): { state: GameState; log: string[] } {
  const s = cloneState(state);
  const log: string[] = [];
  const pLabel = `Player ${playerIndex + 1}`;
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
        drawCards(s.players[i], 2, log, `Player ${i + 1}`);
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
      if (player.costReduction && def.cost) {
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

      // Pay cost
      const excessResources = payResourceCost(player, effectiveCost, bases, log);
      player.hand.splice(action.cardIndex, 1);

      // Expedite: check if any card in hand has Expedite and can be paid with excess
      const totalExcess =
        excessResources.persuasion + excessResources.logistics + excessResources.security;
      if (totalExcess > 0) {
        for (let ei = player.hand.length - 1; ei >= 0; ei--) {
          const expCard = player.hand[ei];
          const expDef = getCardDef(expCard.defId);
          if (!hasKeyword(expDef, "Expedite") || !expDef.cost) continue;
          // Check if excess covers the Expedite card's cost
          let canExpedite = true;
          for (const [rt, amt] of Object.entries(expDef.cost) as [ResourceType, number][]) {
            if ((excessResources[rt] ?? 0) < amt) {
              canExpedite = false;
              break;
            }
          }
          if (!canExpedite) continue;
          // Play the Expedite card for free using excess
          player.hand.splice(ei, 1);
          log.push(`Expedite! ${pLabel} plays ${cardName(expDef)} using excess resources.`);
          if (isUnit(expDef) || isMission(expDef)) {
            const expOverlay =
              isUnit(expDef) &&
              isSingular(expDef) &&
              !checkMissionOverlayPrevention(s, playerIndex, expDef)
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
              fireOnEnterPlay(s, playerIndex, expDef, expCard.instanceId, log);
              if (expDef.type === "ship")
                fireOnShipEnterPlay(s, playerIndex, expCard.instanceId, log);
            }
          } else if (expDef.type === "event") {
            resolveEventEffect(s, playerIndex, expDef, log, undefined);
            if (!s.skipEventDiscard) player.discard.push(expCard);
            s.skipEventDiscard = undefined;
            fireMissionOnEventPlay(s, playerIndex, log);
          }
          // Deduct from excess
          for (const [rt, amt] of Object.entries(expDef.cost) as [ResourceType, number][]) {
            excessResources[rt] -= amt;
          }
          break; // Only one Expedite per play
        }
      }

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
        resolveEventEffect(s, playerIndex, def, log, undefined);
        if (!s.skipEventDiscard) {
          player.discard.push(card);
        }
        s.skipEventDiscard = undefined;
        // Fire mission event-play triggers (Dradis Contact: +1 influence per event)
        fireMissionOnEventPlay(s, playerIndex, log);
      }

      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
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
            commitUnit(player, sourceInstanceId);
          } else if (costType === "commit-exhaust") {
            commitUnit(player, sourceInstanceId);
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
                commitUnit(player, targetInstanceId);
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
                costType === "sacrifice-other" ? 3 : def.abilityId === "centurion-hunt" ? 2 : 1;
              s.challenge.challengerPowerBuff = (s.challenge.challengerPowerBuff ?? 0) + buffAmount;
            } else if (s.challenge && s.challenge.defenderInstanceId === sourceInstanceId) {
              const buffAmount =
                costType === "sacrifice-other" ? 3 : def.abilityId === "centurion-hunt" ? 2 : 1;
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
              if (s.phase !== "gameOver") advanceExecutionTurn(s);
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
                    commitUnit(player, sourceInstanceId);
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
                    if (s.phase !== "gameOver") advanceExecutionTurn(s);
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
          exhaustColonialHeavy798(s, playerIndex, log);
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

      resolveMissionEffect(s, playerIndex, def, log);

      // Remove mission from alert — destination depends on category
      const [missionStack] = player.zones.alert.splice(found.index, 1);
      const missionCard = missionStack.cards[0];
      const category = def.abilityId ? getMissionCategory(def.abilityId) : "one-shot";

      if (category === "persistent") {
        if (!player.zones.persistentMissions) player.zones.persistentMissions = [];
        player.zones.persistentMissions.push(missionCard);
        log.push(`${cardName(def)} is Persistent — stays in play.`);
      } else if (category === "link") {
        const linkType = getLinkTargetType(def.abilityId!);
        const linkTarget = pickLinkTarget(player, linkType, def);
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
          log.push("Execution phase ends (False Peace).");
          startCylonPhase(s, log, bases);
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
      log.push(`${pLabel} challenges with ${cardName(challengerDef)}.`);

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
        // Who picks the defender: Sniper → challenger, otherwise → defending player
        s.activePlayerIndex = selector === "challenger" ? playerIndex : 1 - playerIndex;
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
      // Challenging player gets first chance to play effects
      s.activePlayerIndex = s.challenge.challengerPlayerIndex;
      break;
    }

    // --- Challenge step 2: pass on effects ---
    case "challengePass": {
      if (!s.challenge) break;
      s.challenge.consecutivePasses++;
      log.push(`${pLabel} passes in the challenge.`);

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

      payResourceCost(player, def.cost, bases, log);
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
        log.push("All players passed. Execution phase ends.");
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
      log.push(
        `${pLabel} challenges Cylon threat (power ${threat.power}) with ${challengerDef ? cardName(challengerDef) : "unknown"}.`,
      );

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
      log.push(`${pLabel} passes in Cylon phase. (Now ${player.influence})`);
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

    // --- Triggered ability: use (Agro Ship / Flattop) ---
    case "useTriggeredAbility": {
      if (!s.challenge?.pendingTrigger) break;
      const triggerAbilityId = s.challenge.pendingTrigger.abilityId;
      const triggerPlayerIdx = s.challenge.pendingTrigger.playerIndex;
      const triggerPlayer = s.players[triggerPlayerIdx];

      // Exhaust the base
      const triggerBaseStack = triggerPlayer.zones.resourceStacks[0];
      if (triggerBaseStack) {
        triggerBaseStack.exhausted = true;
      }
      const triggerBaseDef = bases[triggerPlayer.baseDefId];
      log.push(`${pLabel} exhausts ${triggerBaseDef.title}.`);

      // Resolve the trigger (readies the target unit)
      resolveBaseAbilityEffect(
        triggerAbilityId,
        s,
        triggerPlayerIdx,
        action.targetInstanceId,
        log,
        bases,
      );

      // Clear trigger, proceed to defender selection
      s.challenge.pendingTrigger = undefined;
      s.challenge.waitingForDefender = true;
      s.activePlayerIndex =
        s.challenge.defenderSelector === "challenger"
          ? s.challenge.challengerPlayerIndex
          : s.challenge.defenderPlayerIndex;
      break;
    }

    // --- Triggered ability: decline ---
    case "declineTrigger": {
      if (!s.challenge?.pendingTrigger) break;
      log.push(`${pLabel} declines to use triggered ability.`);
      s.challenge.pendingTrigger = undefined;
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
      resolvePendingChoice(s, choice, action.choiceIndex, player, playerIndex, log, bases);
      s.pendingChoice = undefined;
      // If the resolution set up a NEW pendingChoice (chained), stay on same player
      if (s.pendingChoice) {
        // Stay on same player for next choice
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

function checkSetupComplete(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  if (s.players.every((p) => p.hasMulliganed)) {
    log.push("Both players ready. Starting Turn 1.");
    startReadyPhase(s, log, bases);
  }
}

function startReadyPhase(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
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
      const names = toReady.map((st) => getCardDef(st.cards[0].defId).title).join(", ");
      log.push(`Player ${s.players.indexOf(player) + 1} readies: ${names}.`);
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

function advanceReadyStep4(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
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

function advanceReadyStep5(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
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

function startExecutionPhase(s: GameState, log: string[]): void {
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
  log.push("Execution phase begins.");
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
 * Blockading Base Star can exhaust to prevent one threat's text from affecting one player.
 */
function fireCylonThreatRedText(
  s: GameState,
  log: string[],
  bases: Record<string, BaseCardDef>,
): void {
  // Check for Blockading Base Star — if unexhausted, auto-prevent the worst threat's text
  let preventedThreatIdx = -1;
  for (let pi = 0; pi < s.players.length; pi++) {
    const p = s.players[pi];
    if (bases[p.baseDefId]?.abilityId === "blockading-base-star") {
      const baseStack = p.zones.resourceStacks[0];
      if (baseStack && !baseStack.exhausted) {
        // Find the most harmful threat with red text
        let worstIdx = -1;
        let worstScore = -1;
        for (let ti = 0; ti < s.cylonThreats.length; ti++) {
          const def = getCardDef(s.cylonThreats[ti].card.defId);
          if (def.cylonThreatText) {
            const score = s.cylonThreats[ti].power + 1; // prefer higher-power threats
            if (score > worstScore) {
              worstScore = score;
              worstIdx = ti;
            }
          }
        }
        if (worstIdx >= 0) {
          baseStack.exhausted = true;
          preventedThreatIdx = worstIdx;
          const tDef = getCardDef(s.cylonThreats[worstIdx].card.defId);
          log.push(
            `Blockading Base Star: Exhausted to prevent ${cardName(tDef)}'s Cylon threat text.`,
          );
        }
      }
      break;
    }
  }

  // Fire red text for each threat in turn order
  for (let ti = 0; ti < s.cylonThreats.length; ti++) {
    if (ti === preventedThreatIdx) continue; // prevented by Blockading Base Star
    const threat = s.cylonThreats[ti];
    const def = getCardDef(threat.card.defId);
    if (!def.cylonThreatText) continue;

    const text = def.cylonThreatText.toLowerCase();
    log.push(`Cylon threat text (${cardName(def)}): "${def.cylonThreatText}"`);

    // Parse and apply common patterns
    if (text.includes("each player discards a card")) {
      for (const p of s.players) {
        if (p.hand.length > 0) {
          // Discard lowest-mystic card
          let worstIdx = 0;
          let worstVal = Infinity;
          for (let i = 0; i < p.hand.length; i++) {
            const d = getCardDef(p.hand[i].defId);
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
    } else if (text.includes("each player loses 1 influence")) {
      for (let pi = 0; pi < s.players.length; pi++) {
        applyInfluenceLoss(s, pi, 1, log, bases);
      }
      log.push("  → Each player loses 1 influence.");
    } else if (
      text.includes("each player puts the top card of his or her deck into his or her discard pile")
    ) {
      for (const p of s.players) {
        if (p.deck.length > 0) {
          const card = p.deck.shift()!;
          p.discard.push(card);
        }
      }
      log.push("  → Each player mills top card.");
    } else if (text.includes("each player exhausts") && text.includes("base")) {
      for (const p of s.players) {
        const baseStack = p.zones.resourceStacks[0];
        if (baseStack && !baseStack.exhausted) baseStack.exhausted = true;
      }
      log.push("  → Each player exhausts their base.");
    } else if (
      text.includes("each player exhausts") &&
      text.includes("asset") &&
      text.includes("no supply")
    ) {
      for (const p of s.players) {
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
    } else if (text.includes("each player exhausts") && text.includes("asset")) {
      for (const p of s.players) {
        for (let si = 1; si < p.zones.resourceStacks.length; si++) {
          if (!p.zones.resourceStacks[si].exhausted) {
            p.zones.resourceStacks[si].exhausted = true;
            break;
          }
        }
      }
      log.push("  → Each player exhausts an asset.");
    } else if (text.includes("each player exhausts") && text.includes("resource stack")) {
      for (const p of s.players) {
        for (const stack of p.zones.resourceStacks) {
          if (!stack.exhausted) {
            stack.exhausted = true;
            break;
          }
        }
      }
      log.push("  → Each player exhausts a resource stack.");
    } else if (text.includes("each player exhausts") && text.includes("reserve unit")) {
      for (const p of s.players) {
        for (const stack of p.zones.reserve) {
          if (!stack.exhausted && stack.cards[0]?.faceUp) {
            stack.exhausted = true;
            break;
          }
        }
      }
      log.push("  → Each player exhausts a reserve unit.");
    } else if (text.includes("each player exhausts") && text.includes("personnel")) {
      for (const p of s.players) {
        for (const zone of [p.zones.alert, p.zones.reserve]) {
          let found = false;
          for (const stack of zone) {
            if (!stack.exhausted && stack.cards[0]?.faceUp) {
              const d = getCardDef(stack.cards[0].defId);
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
    } else if (
      text.includes("each player commits") &&
      text.includes("exhausts") &&
      text.includes("personnel")
    ) {
      for (const p of s.players) {
        for (const stack of p.zones.alert) {
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.type === "personnel") {
              commitUnit(p, stack.cards[0].instanceId);
              const found = findUnitInAnyZone(p, stack.cards[0].instanceId);
              if (found) found.stack.exhausted = true;
              break;
            }
          }
        }
      }
      log.push("  → Each player commits and exhausts a personnel.");
    } else if (text.includes("each player commits") && text.includes("personnel")) {
      for (const p of s.players) {
        for (const stack of [...p.zones.alert]) {
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.type === "personnel") {
              commitUnit(p, stack.cards[0].instanceId);
              break;
            }
          }
        }
      }
      log.push("  → Each player commits a personnel.");
    } else if (text.includes("each player commits") && text.includes("cylon unit")) {
      for (const p of s.players) {
        for (const stack of [...p.zones.alert]) {
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.traits?.includes("Cylon")) {
              commitUnit(p, stack.cards[0].instanceId);
              break;
            }
          }
        }
      }
      log.push("  → Each player commits a Cylon unit.");
    } else if (text.includes("each player commits") && text.includes("ship")) {
      for (const p of s.players) {
        for (const stack of [...p.zones.alert]) {
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.type === "ship") {
              commitUnit(p, stack.cards[0].instanceId);
              break;
            }
          }
        }
      }
      log.push("  → Each player commits a ship.");
    } else if (text.includes("each player commits") && text.includes("unit")) {
      for (const p of s.players) {
        for (const stack of [...p.zones.alert]) {
          if (stack.cards[0]?.faceUp) {
            commitUnit(p, stack.cards[0].instanceId);
            break;
          }
        }
      }
      log.push("  → Each player commits a unit.");
    } else if (text.includes("each player sacrifices") && text.includes("reserve ship")) {
      for (const p of s.players) {
        for (let i = 0; i < p.zones.reserve.length; i++) {
          const stack = p.zones.reserve[i];
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.type === "ship") {
              p.zones.reserve.splice(i, 1);
              for (const c of stack.cards) p.discard.push(c);
              break;
            }
          }
        }
      }
      log.push("  → Each player sacrifices a reserve ship.");
    } else if (text.includes("each player sacrifices") && text.includes("reserve personnel")) {
      for (const p of s.players) {
        for (let i = 0; i < p.zones.reserve.length; i++) {
          const stack = p.zones.reserve[i];
          if (stack.cards[0]?.faceUp) {
            const d = getCardDef(stack.cards[0].defId);
            if (d.type === "personnel") {
              p.zones.reserve.splice(i, 1);
              for (const c of stack.cards) p.discard.push(c);
              break;
            }
          }
        }
      }
      log.push("  → Each player sacrifices a reserve personnel.");
    } else if (text.includes("each player sacrifices") && text.includes("personnel")) {
      for (const p of s.players) {
        for (const zone of [p.zones.alert, p.zones.reserve]) {
          let found = false;
          for (let i = 0; i < zone.length; i++) {
            const stack = zone[i];
            if (stack.cards[0]?.faceUp) {
              const d = getCardDef(stack.cards[0].defId);
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
    } else if (text.includes("each player sacrifices") && text.includes("unit")) {
      for (const p of s.players) {
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
    } else if (
      text.includes("all politicians get -1 power") ||
      text.includes("all officers get -1 power") ||
      text.includes("all ships get -1 power")
    ) {
      // Power debuffs last until end of phase — tracked via effectImmunity or similar
      // For simplicity, just log (power modifiers during Cylon challenges are ephemeral)
      log.push("  → Power debuff applied (lasts until end of phase).");
    } else if (
      text.includes("puts a card from") &&
      text.includes("hand on top of") &&
      text.includes("deck")
    ) {
      for (const p of s.players) {
        if (p.hand.length > 0) {
          // Put lowest-mystic card on top
          let worstIdx = 0;
          let worstVal = Infinity;
          for (let i = 0; i < p.hand.length; i++) {
            const d = getCardDef(p.hand[i].defId);
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
    } else if (
      text.includes("chooses a personnel card from") &&
      text.includes("discard") &&
      text.includes("hand")
    ) {
      for (const p of s.players) {
        // Find personnel in discard
        for (let i = 0; i < p.discard.length; i++) {
          const d = getCardDef(p.discard[i].defId);
          if (d.type === "personnel") {
            const card = p.discard.splice(i, 1)[0];
            p.hand.push(card);
            break;
          }
        }
      }
      log.push("  → Each player recovers a personnel from discard.");
    } else if (text.includes("readies a ship")) {
      for (const p of s.players) {
        for (const stack of p.zones.reserve) {
          if (stack.cards[0]?.faceUp && !stack.exhausted) {
            const d = getCardDef(stack.cards[0].defId);
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
    } else {
      // Unrecognized text — log it for visibility
      log.push(`  → (Unhandled red text: "${def.cylonThreatText}")`);
    }
  }
}

function startCylonPhase(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  s.phase = "cylon";
  // Cylon Betrayal override: use forced first player if set
  if (s.cylonPhaseFirstOverride !== undefined) {
    s.firstPlayerIndex = s.cylonPhaseFirstOverride;
    s.cylonPhaseFirstOverride = undefined;
    log.push(`Cylon Betrayal: Player ${s.firstPlayerIndex + 1} goes first.`);
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

  const threatLevel = computeCylonThreatLevel(s);
  const effectiveDefense =
    s.fleetDefenseLevel + computeFleetDefenseModifiers(s) + computeMissionFleetDefenseModifier(s);
  log.push(`Cylon phase: threat level is ${threatLevel}, fleet defense is ${effectiveDefense}.`);

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
    const result = revealMysticValue(s.players[i], log, `Player ${i + 1}`);
    const def = getCardDef(result.card.defId);
    const threatPower = (def.cylonThreat ?? 0) + doralBonus;
    s.cylonThreats.push({
      card: result.card,
      power: threatPower,
      ownerIndex: i,
    });
    log.push(
      `Player ${i + 1} reveals ${cardName(def)} as Cylon threat (power ${threatPower}${doralBonus > 0 ? `, includes +${doralBonus} Doral` : ""}).`,
    );
  }

  // Fire Cylon threat red text (rules: "triggers at this time in turn order")
  fireCylonThreatRedText(s, log, bases);

  // Check if ALL revealed threats have the Cylon trait → fleet jumps
  const allCylon = s.cylonThreats.every((t) => {
    const def = getCardDef(t.card.defId);
    return def.traits?.includes("Cylon");
  });
  if (allCylon) {
    log.push("All Cylon threats have the Cylon trait — fleet must jump!");
    for (let pi = 0; pi < s.players.length; pi++) {
      const p = s.players[pi];
      // AI: sacrifice smallest asset (no supply) first, then supply card from largest stack
      let sacrificed = false;
      // Try to sacrifice a bare asset (non-base resource stack with no supply cards)
      for (let si = 1; si < p.zones.resourceStacks.length; si++) {
        if (p.zones.resourceStacks[si].supplyCards.length === 0) {
          const removed = p.zones.resourceStacks.splice(si, 1)[0];
          p.discard.push(removed.topCard);
          log.push(
            `Player ${pi + 1} sacrifices asset ${cardName(getCardDef(removed.topCard.defId))}.`,
          );
          sacrificed = true;
          break;
        }
      }
      if (!sacrificed) {
        // Sacrifice a supply card from any stack
        for (const stack of p.zones.resourceStacks) {
          if (stack.supplyCards.length > 0) {
            const supply = stack.supplyCards.pop()!;
            p.discard.push(supply);
            log.push(`Player ${pi + 1} sacrifices a supply card.`);
            sacrificed = true;
            break;
          }
        }
      }
      if (!sacrificed) {
        log.push(`Player ${pi + 1} has no asset or supply card to sacrifice.`);
      }
    }
    // All threats go to discard
    for (const t of s.cylonThreats) {
      s.players[t.ownerIndex].discard.push(t.card);
    }
    s.cylonThreats = [];
    endCylonPhase(s, log, bases);
    return;
  }

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

function advanceCylonTurn(s: GameState): void {
  s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
}

function endCylonPhase(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  // Put remaining threats into owners' discard piles
  for (const threat of s.cylonThreats) {
    s.players[threat.ownerIndex].discard.push(threat.card);
  }
  s.cylonThreats = [];

  log.push("Cylon phase ends.");
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

function resolveChallenge(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  const challenge = s.challenge!;
  const attackerPlayer = s.players[challenge.challengerPlayerIndex];
  const defenderPlayer = s.players[challenge.defenderPlayerIndex];

  if (challenge.isCylonChallenge) {
    resolveCylonChallenge(s, log, bases);
    return;
  }

  // Find challenger unit
  const challengerStack = findUnitInAnyZone(attackerPlayer, challenge.challengerInstanceId);
  if (!challengerStack) {
    // Challenger left play, challenge ends
    log.push("Challenger left play. Challenge ends.");
    s.challenge = null;
    advanceExecutionTurn(s);
    return;
  }

  if (!challenge.defenderInstanceId) {
    const challengerPowerContext = { phase: s.phase, isChallenger: true };
    const challengerPower =
      getUnitPower(challengerStack.stack) +
      (challenge.challengerPowerBuff ?? 0) +
      computePassivePowerModifier(
        s,
        challengerStack.stack,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
      ) +
      computeMissionPowerModifier(
        s,
        challengerStack.stack,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
      );
    // Undefended challenge — add Six Seductress buff if applicable
    const undefendedPower = challengerPower + (challenge.sixSeductressBuff ?? 0);
    const challengerDef = getCardDef(challengerStack.stack.cards[0].defId);
    const effect = getUndefendedEffect(challengerDef);
    if (effect === "gain-influence") {
      if (s.preventInfluenceGain) {
        log.push("Standoff: influence gain prevented.");
      } else {
        attackerPlayer.influence += undefendedPower;
        log.push(
          `Manipulate! Player ${challenge.challengerPlayerIndex + 1} gains ${undefendedPower} influence. (Now ${attackerPlayer.influence})`,
        );
      }
    } else {
      applyInfluenceLoss(s, challenge.defenderPlayerIndex, undefendedPower, log, bases);
      log.push(
        `Undefended! Player ${challenge.defenderPlayerIndex + 1} loses influence. (Now ${defenderPlayer.influence})`,
      );
    }
    commitUnit(attackerPlayer, challenge.challengerInstanceId);
  } else {
    // Defended challenge — reveal mystic values (with hooks)
    let atkMysticValue: number;
    let defMysticValue: number;

    // Attacker mystic reveal
    const atkMystic = revealMysticValue(
      attackerPlayer,
      log,
      `Player ${challenge.challengerPlayerIndex + 1}`,
    );
    atkMysticValue = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic.value);
    // Double mystic reveal (Elosha Priestess / Channel the Lords)
    if (challenge.doubleMysticReveal === challenge.challengerPlayerIndex) {
      const atkMystic2 = revealMysticValue(
        attackerPlayer,
        log,
        `Player ${challenge.challengerPlayerIndex + 1} (double)`,
      );
      atkMysticValue += fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic2.value);
      log.push(`Double mystic reveal total = ${atkMysticValue}.`);
    }
    // Spot Judgment: reveal 2, pick best
    if (challenge.selfDoubleMystic === challenge.challengerPlayerIndex) {
      const atkMystic2 = revealMysticValue(
        attackerPlayer,
        log,
        `Player ${challenge.challengerPlayerIndex + 1} (Spot Judgment)`,
      );
      const val2 = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic2.value);
      atkMysticValue = Math.max(atkMysticValue, val2);
      log.push(`Spot Judgment: best mystic value = ${atkMysticValue}.`);
    }

    // Defender mystic reveal
    const defMystic = revealMysticValue(
      defenderPlayer,
      log,
      `Player ${challenge.defenderPlayerIndex + 1}`,
    );
    defMysticValue = fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic.value);
    if (challenge.doubleMysticReveal === challenge.defenderPlayerIndex) {
      const defMystic2 = revealMysticValue(
        defenderPlayer,
        log,
        `Player ${challenge.defenderPlayerIndex + 1} (double)`,
      );
      defMysticValue += fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic2.value);
      log.push(`Double mystic reveal total = ${defMysticValue}.`);
    }
    // Spot Judgment: reveal 2, pick best (defender)
    if (challenge.selfDoubleMystic === challenge.defenderPlayerIndex) {
      const defMystic2 = revealMysticValue(
        defenderPlayer,
        log,
        `Player ${challenge.defenderPlayerIndex + 1} (Spot Judgment)`,
      );
      const val2 = fireOnMysticReveal(s, challenge.defenderPlayerIndex, defMystic2.value);
      defMysticValue = Math.max(defMysticValue, val2);
      log.push(`Spot Judgment: best mystic value = ${defMysticValue}.`);
    }
    // False Sense of Security: opponent reveals 2, controller picks worst
    if (challenge.opponentDoubleMystic) {
      const odm = challenge.opponentDoubleMystic;
      const oppPlayer = s.players[odm.opponentIndex];
      const oppMystic2 = revealMysticValue(
        oppPlayer,
        log,
        `Player ${odm.opponentIndex + 1} (False Sense of Security)`,
      );
      const val2 = fireOnMysticReveal(s, odm.opponentIndex, oppMystic2.value);
      if (odm.opponentIndex === challenge.challengerPlayerIndex) {
        atkMysticValue = Math.min(atkMysticValue, val2);
        log.push(`False Sense of Security: opponent's worst mystic = ${atkMysticValue}.`);
      } else {
        defMysticValue = Math.min(defMysticValue, val2);
        log.push(`False Sense of Security: opponent's worst mystic = ${defMysticValue}.`);
      }
    }

    // Defender-left-play: if defender left play during effects, challenge ends
    const defenderStack = findUnitInAnyZone(defenderPlayer, challenge.defenderInstanceId);
    if (!defenderStack) {
      log.push("Defender left play during challenge. Challenge ends. Challenger commits.");
      commitUnit(attackerPlayer, challenge.challengerInstanceId);
      s.challenge = null;
      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        advanceExecutionTurn(s);
      }
      return;
    }

    const defenderDefForContext = getCardDef(defenderStack.stack.cards[0].defId);
    const challengerDefForContext = getCardDef(challengerStack.stack.cards[0].defId);
    const challengerPowerContext = {
      phase: s.phase,
      isChallenger: true,
      defenderDef: defenderDefForContext,
    };
    const challengerPower =
      getUnitPower(challengerStack.stack) +
      (challenge.challengerPowerBuff ?? 0) +
      computePassivePowerModifier(
        s,
        challengerStack.stack,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
      ) +
      computeMissionPowerModifier(
        s,
        challengerStack.stack,
        challenge.challengerPlayerIndex,
        challengerPowerContext,
      );
    const atkTotal = challengerPower + atkMysticValue;
    const defPowerContext = {
      phase: s.phase,
      isDefender: true,
      challengerDef: challengerDefForContext,
    };
    const defPower =
      getUnitPower(defenderStack.stack) +
      (challenge.defenderPowerBuff ?? 0) +
      computePassivePowerModifier(
        s,
        defenderStack.stack,
        challenge.defenderPlayerIndex,
        defPowerContext,
      ) +
      computeMissionPowerModifier(
        s,
        defenderStack.stack,
        challenge.defenderPlayerIndex,
        defPowerContext,
      );
    const defTotal = defPower + defMysticValue;

    log.push(`Challenger total: ${atkTotal} (${challengerPower} + ${atkMysticValue})`);
    log.push(`Defender total: ${defTotal} (${defPower} + ${defMysticValue})`);

    if (atkTotal >= defTotal) {
      // Challenger wins (ties go to challenger)
      log.push("Challenger wins!");
      commitUnit(attackerPlayer, challenge.challengerInstanceId);
      // Discourage Pursuit: defender immune to defeat
      if (challenge.defenderImmune) {
        commitUnit(defenderPlayer, challenge.defenderInstanceId);
        log.push("Discourage Pursuit: defender is immune to defeat (committed instead).");
      } else if (challenge.losesExhaustedNotDefeated) {
        // Dr. Cottle Surgeon: exhaust instead of defeat
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
      // Discourage Pursuit: challenger defeated if they win
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
      // Fire onChallengeWin triggers (e.g., Nuclear-Armed Raider: defeat asset)
      fireOnChallengeWin(s, challenge.challengerPlayerIndex, challenge.challengerInstanceId, log);
      // Fire mission challenge-win triggers (Last Word: gain influence = power diff)
      fireMissionOnChallengeWinHook(
        s,
        challenge.challengerPlayerIndex,
        challengerStack.stack,
        defenderStack.stack,
        atkTotal - defTotal,
        log,
      );
    } else {
      // Defender wins
      log.push("Defender wins!");
      commitUnit(defenderPlayer, challenge.defenderInstanceId);
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
      // Fire onChallengeWin triggers for defender win
      fireOnChallengeWin(s, challenge.defenderPlayerIndex, challenge.defenderInstanceId!, log);
      // Fire mission challenge-win triggers for defender
      fireMissionOnChallengeWinHook(
        s,
        challenge.defenderPlayerIndex,
        defenderStack.stack,
        challengerStack.stack,
        defTotal - atkTotal,
        log,
      );
    }
  }

  // Fire challenge-end triggers (Gaeta ready, Tigh XO, Centurion Tracker, Helo Toaster-Lover)
  fireOnChallengeEnd(s, challenge, log);

  // Agro Ship / Flattop: commit the readied unit at end of challenge
  if (s.challenge!.triggerReadiedInstanceId) {
    const triggerOwner = s.players[s.challenge!.defenderPlayerIndex];
    const readiedId = s.challenge!.triggerReadiedInstanceId;
    const readiedUnit = findUnitInAnyZone(triggerOwner, readiedId);
    if (readiedUnit && readiedUnit.zone === "alert") {
      commitUnit(triggerOwner, readiedId);
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

  s.challenge = null;
  checkVictory(s, log);
  if (s.phase !== "gameOver") {
    advanceExecutionTurn(s);
  }
}

function resolveCylonChallenge(
  s: GameState,
  log: string[],
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
  const challengerPower =
    getUnitPower(challengerStack.stack) +
    (challenge.challengerPowerBuff ?? 0) +
    computePassivePowerModifier(
      s,
      challengerStack.stack,
      challenge.challengerPlayerIndex,
      cylonChallengerCtx,
    ) +
    computeMissionPowerModifier(
      s,
      challengerStack.stack,
      challenge.challengerPlayerIndex,
      cylonChallengerCtx,
    );

  // Reveal mystic values (with hooks)
  const atkMystic = revealMysticValue(
    attackerPlayer,
    log,
    `Player ${challenge.challengerPlayerIndex + 1}`,
  );
  const atkMysticValue = fireOnMysticReveal(s, challenge.challengerPlayerIndex, atkMystic.value);
  const defMystic = revealMysticValue(
    cylonPlayer,
    log,
    `Player ${challenge.cylonPlayerIndex! + 1} (Cylon player)`,
  );

  const threatIdx = challenge.cylonThreatIndex!;
  const threat = s.cylonThreats[threatIdx];
  if (!threat) {
    s.challenge = null;
    return;
  }

  const atkTotal = challengerPower + atkMysticValue;
  const defTotal = threat.power + defMystic.value;

  log.push(`Challenger total: ${atkTotal} (${challengerPower} + ${atkMysticValue})`);
  log.push(`Cylon threat total: ${defTotal} (${threat.power} + ${defMystic.value})`);

  if (atkTotal >= defTotal) {
    log.push("Challenger defeats the Cylon threat!");
    // Gain influence (2 in 2-player, 1 in 3+ player)
    const gain = s.players.length === 2 ? 2 : 1;
    if (s.preventInfluenceGain) {
      log.push("Standoff: influence gain prevented.");
    } else {
      attackerPlayer.influence += gain;
      log.push(
        `Player ${challenge.challengerPlayerIndex + 1} gains ${gain} influence. (Now ${attackerPlayer.influence})`,
      );
    }
    commitUnit(attackerPlayer, challenge.challengerInstanceId);
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

function commitUnit(player: PlayerState, instanceId: string): void {
  const found = findUnitInAnyZone(player, instanceId);
  if (found && found.zone === "alert") {
    player.zones.alert.splice(found.index, 1);
    player.zones.reserve.push(found.stack);
  }
}

function defeatUnit(
  player: PlayerState,
  instanceId: string,
  log: string[],
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
  log?: string[],
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
  return excess;
}

/** Freighter resource type mapping. */
const FREIGHTER_RESOURCE: Record<string, ResourceType> = {
  "ordnance-freighter": "security",
  "supply-freighter": "logistics",
  "troop-freighter": "persuasion",
};

/** Commit alert freighters to generate their resource type, reducing remaining cost. */
function commitFreightersForResource(
  player: PlayerState,
  resType: ResourceType,
  remaining: number,
  log?: string[],
): number {
  for (let i = player.zones.alert.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const stack = player.zones.alert[i];
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (!def.abilityId || FREIGHTER_RESOURCE[def.abilityId] !== resType) continue;
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
    if (def.abilityId && FREIGHTER_RESOURCE[def.abilityId] === resType) {
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
    if (def.abilityId && FREIGHTER_RESOURCE[def.abilityId]) {
      count++;
    }
  }
  return count;
}

/** Spend N resource stacks of any type (Difference of Opinion challenge cost). Prefers smallest stacks. */
function spendAnyResources(player: PlayerState, count: number, log: string[]): void {
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
      if (!def.abilityId || !FREIGHTER_RESOURCE[def.abilityId]) continue;
      player.zones.alert.splice(i, 1);
      player.zones.reserve.push(stack);
      remaining--;
      log.push(`${cardName(def)}: committed to generate ${FREIGHTER_RESOURCE[def.abilityId]}.`);
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

/** Cloud 9, Cruise Ship: commit to reduce influence loss by 1. */
function interceptCloud9(s: GameState, playerIndex: number, amount: number, log: string[]): number {
  if (amount <= 0) return amount;
  const player = s.players[playerIndex];
  for (const stack of player.zones.alert) {
    if (amount <= 0) break;
    if (stack.exhausted) continue;
    const topCard = stack.cards[0];
    if (!topCard?.faceUp) continue;
    const def = getCardDef(topCard.defId);
    if (def.abilityId !== "cloud9-shield") continue;
    // Commit the ship to reduce loss by 1
    commitUnit(player, topCard.instanceId);
    amount = Math.max(0, amount - 1);
    log.push(`Cloud 9, Cruise Ship: committed to reduce influence loss by 1.`);
  }
  return amount;
}

/** Apply influence loss with prevention check and I.H.T. Colonial One interception. */
function applyInfluenceLoss(
  s: GameState,
  playerIndex: number,
  amount: number,
  log: string[],
  bases: Record<string, BaseCardDef>,
): void {
  if (s.preventInfluenceLoss) {
    log.push("Executive Privilege: influence loss prevented.");
    return;
  }
  let adjusted = interceptInfluenceLoss(s, playerIndex, amount, log, bases);
  // Cloud 9, Cruise Ship: commit to reduce influence loss by 1
  if (adjusted > 0) {
    adjusted = interceptCloud9(s, playerIndex, adjusted, log);
  }
  if (adjusted > 0) {
    s.players[playerIndex].influence -= adjusted;
  }
}

/** Resolve a pending choice by type. */
function resolvePendingChoice(
  s: GameState,
  choice: NonNullable<GameState["pendingChoice"]>,
  choiceIndex: number,
  player: PlayerState,
  playerIndex: number,
  log: string[],
  _bases: Record<string, BaseCardDef>,
): void {
  const ctx = (choice.context ?? {}) as Record<string, unknown>;

  switch (choice.type) {
    case "celestra": {
      const chosenCard = choice.cards[choiceIndex];
      const otherCard = choice.cards[1 - choiceIndex];
      if (chosenCard && otherCard) {
        const chosenDef = getCardDef(chosenCard.defId);
        const otherDef = getCardDef(otherCard.defId);
        player.deck.unshift(chosenCard);
        player.deck.push(otherCard);
        log.push(
          `Player ${playerIndex + 1} puts ${cardName(chosenDef)} on top and ${cardName(otherDef)} on the bottom.`,
        );
      }
      break;
    }

    case "space-park-scry": {
      const card = choice.cards[0];
      if (!card) break;
      const def = getCardDef(card.defId);
      if (choiceIndex === 0) {
        // Keep on top — card is already removed from deck, put back on top
        player.deck.unshift(card);
        log.push(`Space Park: Kept ${cardName(def)} on top.`);
      } else {
        // Put on bottom
        player.deck.push(card);
        log.push(`Space Park: Put ${cardName(def)} on bottom.`);
      }
      break;
    }

    case "mining-ship-dig": {
      // Opponent chose which card goes to bottom; the other goes to the owner's hand
      const ownerIdx = ctx.ownerIndex as number;
      const owner = s.players[ownerIdx];
      const bottomCard = choice.cards[choiceIndex];
      const handCard = choice.cards[1 - choiceIndex];
      if (bottomCard && handCard) {
        owner.deck.push(bottomCard);
        owner.hand.push(handCard);
        const bDef = getCardDef(bottomCard.defId);
        const hDef = getCardDef(handCard.defId);
        log.push(`Mining Ship: ${cardName(bDef)} goes to bottom, ${cardName(hDef)} goes to hand.`);
      }
      break;
    }

    case "boomer-search": {
      if (choiceIndex >= choice.cards.length) {
        // "Take nothing" option
        log.push("Boomer: Chose not to take a personnel.");
        // Shuffle deck (we searched it)
        for (let j = player.deck.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
        }
      } else {
        const card = choice.cards[choiceIndex];
        const def = getCardDef(card.defId);
        // Remove from deck and add to hand
        const deckIdx = player.deck.findIndex((c) => c.instanceId === card.instanceId);
        if (deckIdx >= 0) player.deck.splice(deckIdx, 1);
        player.hand.push(card);
        log.push(`Boomer: Searched deck and found ${cardName(def)}.`);
        // Shuffle remaining deck
        for (let j = player.deck.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [player.deck[j], player.deck[k]] = [player.deck[k], player.deck[j]];
        }
      }
      break;
    }

    case "godfrey-reveal": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      const oppIdx = ctx.opponentIndex as number;
      const opp = s.players[oppIdx];
      const def = getCardDef(chosenCard.defId);
      // Remove from opponent's hand and put on top of their deck
      const handIdx = opp.hand.findIndex((c) => c.instanceId === chosenCard.instanceId);
      if (handIdx >= 0) {
        opp.hand.splice(handIdx, 1);
        opp.deck.unshift(chosenCard);
        log.push(`Godfrey: ${cardName(def)} put on top of opponent's deck.`);
      }
      break;
    }

    case "act-of-contrition": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      const oppIdx = ctx.opponentIndex as number;
      const opp = s.players[oppIdx];
      const def = getCardDef(chosenCard.defId);
      const handIdx = opp.hand.findIndex((c) => c.instanceId === chosenCard.instanceId);
      if (handIdx >= 0) {
        opp.hand.splice(handIdx, 1);
        opp.discard.push(chosenCard);
        log.push(`Act of Contrition: ${cardName(def)} discarded from opponent's hand.`);
      }
      break;
    }

    case "zarek-etb": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      // Find which player owns this unit and defeat it
      for (let pi = 0; pi < s.players.length; pi++) {
        const p = s.players[pi];
        const found = findUnitInAnyZone(p, chosenCard.instanceId);
        if (found) {
          defeatUnit(p, chosenCard.instanceId, log, s, pi);
          log.push("Tom Zarek: Defeats a personnel on entering play.");
          break;
        }
      }
      break;
    }

    case "astral-queen-second": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      // Exhaust the second target
      for (const p of s.players) {
        const found = findUnitInAnyZone(p, chosenCard.instanceId);
        if (found) {
          found.stack.exhausted = true;
          const def = getCardDef(found.stack.cards[0].defId);
          log.push(`Astral Queen: ${cardName(def)} also exhausted.`);
          break;
        }
      }
      break;
    }

    case "covering-fire-commit": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      const commitDef = getCardDef(chosenCard.defId);
      commitUnit(player, chosenCard.instanceId);
      log.push(`Covering Fire: ${cardName(commitDef)} committed.`);
      // Apply +2 power to the original target
      const targetId = ctx.targetId as string;
      if (targetId) {
        applyPowerBuff(s, targetId, 2, log);
        log.push("Covering Fire: target unit gets +2 power.");
      }
      break;
    }

    case "distraction-commit": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      const commitDef = getCardDef(chosenCard.defId);
      commitUnit(player, chosenCard.instanceId);
      log.push(`Distraction: ${cardName(commitDef)} committed.`);
      // Commit+exhaust the original target
      const targetId = ctx.targetId as string;
      if (targetId) {
        for (const p of s.players) {
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
      break;
    }

    case "military-coup-exhaust": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      // Exhaust chosen own personnel
      const found = findUnitInAnyZone(player, chosenCard.instanceId);
      if (found) found.stack.exhausted = true;
      const ownDef = getCardDef(chosenCard.defId);
      log.push(`Military Coup: ${cardName(ownDef)} exhausted.`);
      // Exhaust target opponent personnel
      const targetId = ctx.targetId as string;
      if (targetId) {
        for (const p of s.players) {
          const tgt = findUnitInAnyZone(p, targetId);
          if (tgt) {
            tgt.stack.exhausted = true;
            log.push("Military Coup: target opponent personnel exhausted.");
            break;
          }
        }
      }
      break;
    }

    case "painful-recovery-cylon": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      // Remove chosen Cylon unit from play and put on top of deck
      const found = findUnitInAnyZone(player, chosenCard.instanceId);
      if (found) {
        const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
        zone.splice(found.index, 1);
        for (const card of found.stack.cards.reverse()) {
          player.deck.unshift(card);
        }
        const d = getCardDef(chosenCard.defId);
        log.push(`Painful Recovery: ${cardName(d)} put on top of deck.`);
      }
      // Commit+exhaust target personnel
      const targetId = ctx.targetId as string;
      if (targetId) {
        for (const p of s.players) {
          const tgt = findUnitInAnyZone(p, targetId);
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
      }
      break;
    }

    case "suicide-bomber-cylon": {
      const chosenCard = choice.cards[choiceIndex];
      if (!chosenCard) break;
      // Sacrifice chosen Cylon personnel
      const found = findUnitInAnyZone(player, chosenCard.instanceId);
      if (found) {
        const zone = found.zone === "alert" ? player.zones.alert : player.zones.reserve;
        zone.splice(found.index, 1);
        for (const card of found.stack.cards) player.discard.push(card);
        const d = getCardDef(chosenCard.defId);
        log.push(`Suicide Bomber: ${cardName(d)} sacrificed.`);
      }
      // Defeat first target
      const targetId = ctx.targetId as string;
      if (targetId) {
        for (let pi = 0; pi < s.players.length; pi++) {
          const p = s.players[pi];
          if (findUnitInAnyZone(p, targetId)) {
            defeatUnit(p, targetId, log, s, pi);
            break;
          }
        }
      }
      // Set up second target choice
      const secondTargets: CardInstance[] = [];
      for (const p of s.players) {
        for (const zone of [p.zones.alert, p.zones.reserve]) {
          for (const stack of zone) {
            const tc = stack.cards[0];
            if (tc?.faceUp && tc.instanceId !== targetId) {
              const d = getCardDef(tc.defId);
              if (d?.type === "personnel") secondTargets.push(tc);
            }
          }
        }
      }
      if (secondTargets.length > 0) {
        s.pendingChoice = {
          type: "suicide-bomber-target2",
          playerIndex,
          cards: secondTargets,
        };
      }
      break;
    }

    case "suicide-bomber-target2": {
      if (choiceIndex >= choice.cards.length) {
        // "No second target" option
        log.push("Suicide Bomber: No second target.");
      } else {
        const chosenCard = choice.cards[choiceIndex];
        if (chosenCard) {
          for (let pi = 0; pi < s.players.length; pi++) {
            const p = s.players[pi];
            if (findUnitInAnyZone(p, chosenCard.instanceId)) {
              defeatUnit(p, chosenCard.instanceId, log, s, pi);
              log.push("Suicide Bomber: Second personnel defeated.");
              break;
            }
          }
        }
      }
      break;
    }

    case "decoys-count": {
      const count = choiceIndex + 1; // choiceIndex 0 = commit 1, etc.
      const targetId = ctx.targetId as string;
      // Commit lowest-power alert units (excluding target)
      const eligible = player.zones.alert.filter(
        (st) => !st.exhausted && st.cards[0] && st.cards[0].instanceId !== targetId,
      );
      eligible.sort((a, b) => {
        const aPow = getCardDef(a.cards[0].defId)?.power ?? 0;
        const bPow = getCardDef(b.cards[0].defId)?.power ?? 0;
        return aPow - bPow;
      });
      let committed = 0;
      for (const st of eligible) {
        if (committed >= count) break;
        commitUnit(player, st.cards[0].instanceId);
        committed++;
      }
      if (committed > 0 && targetId) {
        applyPowerBuff(s, targetId, committed * 2, log);
        log.push(`Decoys: ${committed} unit(s) committed, target gets +${committed * 2} power.`);
      }
      break;
    }

    case "reformat-count": {
      const discardCount = choiceIndex + 1; // choiceIndex 0 = discard 1, etc.
      // Discard lowest-mystic cards
      const sorted = player.hand
        .map((c, i) => ({ card: c, idx: i, mystic: getCardDef(c.defId)?.mysticValue ?? 0 }))
        .sort((a, b) => a.mystic - b.mystic);
      const toDiscard = sorted.slice(0, discardCount);
      const indices = toDiscard.map((t) => t.idx).sort((a, b) => b - a);
      for (const idx of indices) {
        const removed = player.hand.splice(idx, 1)[0];
        player.discard.push(removed);
      }
      drawCards(player, discardCount, log, `Player ${playerIndex + 1}`, s, playerIndex);
      log.push(`Reformat: discarded ${discardCount} cards, drew ${discardCount}.`);
      break;
    }
  }
}

/** Get valid actions for a pending choice. */
function getPendingChoiceActions(state: GameState): ValidAction[] {
  const choice = state.pendingChoice;
  if (!choice) return [];
  const actions: ValidAction[] = [];

  switch (choice.type) {
    case "celestra": {
      for (let i = 0; i < choice.cards.length; i++) {
        const def = getCardDef(choice.cards[i].defId);
        actions.push({
          type: "makeChoice",
          description: `Keep ${cardName(def)} on top`,
          cardDefId: def.id,
        });
      }
      break;
    }

    case "space-park-scry": {
      // Binary: keep on top or put on bottom
      const def = getCardDef(choice.cards[0].defId);
      actions.push({
        type: "makeChoice",
        description: `Keep ${cardName(def)} on top`,
        cardDefId: def.id,
      });
      actions.push({
        type: "makeChoice",
        description: `Put ${cardName(def)} on bottom`,
        cardDefId: def.id,
      });
      break;
    }

    case "mining-ship-dig": {
      // Opponent picks which card goes to bottom (other goes to owner's hand)
      for (let i = 0; i < choice.cards.length; i++) {
        const def = getCardDef(choice.cards[i].defId);
        actions.push({
          type: "makeChoice",
          description: `Send ${cardName(def)} to bottom`,
          cardDefId: def.id,
        });
      }
      break;
    }

    case "boomer-search":
    case "godfrey-reveal":
    case "act-of-contrition":
    case "zarek-etb":
    case "astral-queen-second": {
      // Pick one card from the list
      for (let i = 0; i < choice.cards.length; i++) {
        const def = getCardDef(choice.cards[i].defId);
        const label =
          choice.type === "boomer-search"
            ? `Take ${cardName(def)}`
            : choice.type === "godfrey-reveal"
              ? `Put ${cardName(def)} on deck`
              : choice.type === "act-of-contrition"
                ? `Discard ${cardName(def)}`
                : choice.type === "zarek-etb"
                  ? `Defeat ${cardName(def)}`
                  : `Exhaust ${cardName(def)}`;
        actions.push({ type: "makeChoice", description: label, cardDefId: def.id });
      }
      // boomer-search allows declining (no penalty per rules)
      if (choice.type === "boomer-search") {
        actions.push({ type: "makeChoice", description: "Take nothing" });
      }
      break;
    }

    case "suicide-bomber-target2": {
      // Pick second personnel to defeat
      for (let i = 0; i < choice.cards.length; i++) {
        const def = getCardDef(choice.cards[i].defId);
        actions.push({
          type: "makeChoice",
          description: `Defeat ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
      // Can choose not to defeat a second target
      actions.push({ type: "makeChoice", description: "No second target" });
      break;
    }

    case "covering-fire-commit":
    case "distraction-commit":
    case "military-coup-exhaust":
    case "painful-recovery-cylon":
    case "suicide-bomber-cylon": {
      // Pick own unit to commit/exhaust/sacrifice as cost
      for (let i = 0; i < choice.cards.length; i++) {
        const def = getCardDef(choice.cards[i].defId);
        const verb =
          choice.type === "military-coup-exhaust"
            ? "Exhaust"
            : choice.type === "painful-recovery-cylon"
              ? "Put on deck"
              : choice.type === "suicide-bomber-cylon"
                ? "Sacrifice"
                : "Commit";
        actions.push({
          type: "makeChoice",
          description: `${verb} ${cardName(def)}`,
          cardDefId: def.id,
        });
      }
      break;
    }

    case "decoys-count": {
      // Choose how many units to commit (1 to N)
      const maxCommit = (choice.context?.maxCommit as number) ?? 1;
      for (let i = 1; i <= maxCommit; i++) {
        actions.push({
          type: "makeChoice",
          description: `Commit ${i} unit${i > 1 ? "s" : ""} (+${i * 2} power)`,
        });
      }
      break;
    }

    case "reformat-count": {
      // Choose how many cards to discard (1 to hand size)
      const maxDiscard = (choice.context?.maxDiscard as number) ?? 1;
      for (let i = 1; i <= maxDiscard; i++) {
        actions.push({ type: "makeChoice", description: `Discard ${i}, draw ${i}` });
      }
      break;
    }
  }

  return actions;
}

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
  log: string[],
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
      log.push(`Challenger gets +${amount} power.`);
    } else if (c.defenderInstanceId === targetInstanceId) {
      c.defenderPowerBuff = (c.defenderPowerBuff ?? 0) + amount;
      log.push(`Defender gets +${amount} power.`);
    }
  }
  // Outside of challenge, power buffs last until end of phase (simplified: immediate effect)
}

function resolveEventEffect(
  s: GameState,
  playerIndex: number,
  def: CardDef,
  log: string[],
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
  log: string[],
): void {
  if (def.abilityId) {
    resolveMissionAbility(def.abilityId, s, playerIndex, undefined, log);
  } else {
    log.push(`Mission ${cardName(def)} resolved (no effect).`);
  }
}

// ============================================================
// Victory Check
// ============================================================

function checkVictory(s: GameState, log: string[]): void {
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].influence >= 20) {
      s.phase = "gameOver";
      s.winner = i;
      log.push(`Player ${i + 1} wins! Influence reached ${s.players[i].influence}.`);
      return;
    }
  }
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].influence <= 0) {
      s.phase = "gameOver";
      s.winner = 1 - i;
      log.push(
        `Player ${i + 1} loses! Influence dropped to ${s.players[i].influence}. Player ${2 - i} wins!`,
      );
      return;
    }
  }
}
