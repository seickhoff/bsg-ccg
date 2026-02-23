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
  CylonThreatCard,
  BaseCardDef,
  CardDef,
  CardCost,
  ResourceType,
  ReadyStep,
  OpponentView,
} from "@bsg/shared";
// Card registry — populated at startup via setCardRegistry()
let cardRegistry: Record<string, CardDef> = {};

export function setCardRegistry(cards: Record<string, CardDef>): void {
  cardRegistry = cards;
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
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        total += getCardDef(topCard.defId).cylonThreat ?? 0;
      }
    }
    for (const stack of player.zones.reserve) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        total += getCardDef(topCard.defId).cylonThreat ?? 0;
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

function drawCards(player: PlayerState, count: number, log: string[], playerLabel: string): void {
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
    log: [...log, "Game created. Players may choose to keep or redraw their hands."],
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
    influence: opp.influence,
  };

  return {
    you: {
      playerIndex,
      zones: you.zones,
      hand: you.hand,
      deckCount: you.deck.length,
      discardCount: you.discard.length,
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
      if (player.hand.length > 0) {
        const allIndices = player.hand.map((_: CardInstance, i: number) => i);
        actions.push({
          type: "playToResource",
          description: "Deploy a card to resource area",
          selectableCardIndices: allIndices,
          selectableStackIndices: player.zones.resourceStacks.map(
            (_: ResourceStack, i: number) => i,
          ),
        });
      }
      actions.push({ type: "passResource", description: "Pass (don't play to resource area)" });
    }
    return actions;
  }

  if (state.phase === "ready" && state.readyStep === 5 && isActive) {
    actions.push({ type: "doneReorder", description: "Done reordering stacks" });
    return actions;
  }

  // --- Execution phase ---
  if (state.phase === "execution" && isActive) {
    // Play a card from hand
    for (let i = 0; i < player.hand.length; i++) {
      const def = getCardDef(player.hand[i].defId);
      if (canAfford(player, def, bases)) {
        actions.push({
          type: "playCard",
          description: `Play ${cardName(def)}`,
          selectableCardIndices: [i],
        });
      }
    }

    // Play ability (base exhaust abilities, unit commit/exhaust abilities)
    const baseDef = bases[player.baseDefId];
    if (baseDef?.abilityId && !player.zones.resourceStacks[0].exhausted) {
      actions.push({
        type: "playAbility",
        description: `Use ${baseDef.title} ability: ${baseDef.abilityText}`,
        selectableInstanceIds: [player.zones.resourceStacks[0].topCard.instanceId],
      });
    }
    // Unit abilities (e.g., Adama's Commit)
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp && !stack.exhausted) {
        const def = getCardDef(topCard.defId);
        if (def.abilityId && def.abilityText.startsWith("Commit:")) {
          actions.push({
            type: "playAbility",
            description: `${cardName(def)}: ${def.abilityText}`,
            selectableInstanceIds: [topCard.instanceId],
          });
        }
      }
    }

    // Challenge with an alert unit
    const challengeUnits: string[] = [];
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp && !stack.exhausted) {
        const def = getCardDef(topCard.defId);
        if (isUnit(def)) {
          challengeUnits.push(topCard.instanceId);
        }
      }
    }
    if (challengeUnits.length > 0) {
      actions.push({
        type: "challenge",
        description: "Challenge opponent",
        selectableInstanceIds: challengeUnits,
      });
    }

    // Resolve a mission
    if (!player.hasResolvedMission) {
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.faceUp) {
          const def = getCardDef(topCard.defId);
          if (isMission(def)) {
            // Check if mission requirements are met
            if (canResolveMission(player, def)) {
              actions.push({
                type: "resolveMission",
                description: `Resolve ${cardName(def)}: ${def.abilityText}`,
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
        if (isUnit(def)) {
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

  // Waiting for defender choice
  if (challenge.waitingForDefender && playerIndex === challenge.defenderPlayerIndex) {
    // Find eligible defenders (same type as challenger, face-up alert)
    const challengerDef = findCardDefByInstanceId(state, challenge.challengerInstanceId);
    if (challengerDef) {
      const defenders: string[] = [];
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.faceUp && !stack.exhausted) {
          const def = getCardDef(topCard.defId);
          if (isUnit(def) && def.type === challengerDef.type) {
            defenders.push(topCard.instanceId);
          }
        }
      }
      if (defenders.length > 0) {
        actions.push({
          type: "defend",
          description: "Choose a defender",
          selectableInstanceIds: defenders,
        });
      }
    }
    actions.push({ type: "defend", description: "Decline to defend" });
    return actions;
  }

  // Step 2: play effects round
  if (challenge.step === 2 && state.activePlayerIndex === playerIndex) {
    // Can play events from hand
    for (let i = 0; i < player.hand.length; i++) {
      const def = getCardDef(player.hand[i].defId);
      if (def.type === "event" && canAfford(player, def, bases)) {
        actions.push({
          type: "playEventInChallenge",
          description: `Play ${cardName(def)}: ${def.abilityText}`,
          selectableCardIndices: [i],
        });
      }
    }

    // Can play abilities (commit/exhaust abilities on alert units)
    for (const stack of player.zones.alert) {
      const topCard = stack.cards[0];
      if (topCard && topCard.faceUp) {
        const def = getCardDef(topCard.defId);
        if (def.abilityId && def.abilityText.startsWith("Commit:")) {
          actions.push({
            type: "playAbility",
            description: `${cardName(def)}: ${def.abilityText}`,
            selectableInstanceIds: [topCard.instanceId],
          });
        }
      }
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
  for (const [resType, amount] of Object.entries(def.cost) as [ResourceType, number][]) {
    let available = 0;
    for (const stack of player.zones.resourceStacks) {
      if (stack.exhausted) continue;
      if (getStackResourceTypeFromPlayer(stack, bases, player) === resType) {
        available += stackResourceCount(stack);
      }
    }
    if (available < amount) return false;
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

function canResolveMission(player: PlayerState, missionDef: CardDef): boolean {
  // Simple parsing of mission requirements from abilityText
  // Format: "Resolve: 1 ship. ..." or "Resolve: 1 personnel. ..."
  const match = missionDef.abilityText.match(/Resolve:\s*(\d+)\s+(ship|personnel)/i);
  if (!match) return true;
  const count = parseInt(match[1]);
  const reqType = match[2].toLowerCase();

  let available = 0;
  for (const stack of player.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard && topCard.faceUp && !stack.exhausted) {
      const def = getCardDef(topCard.defId);
      if (def.type === reqType) available++;
    }
  }
  return available >= count;
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

      // Pay cost
      payResourceCost(player, def.cost, bases);
      player.hand.splice(action.cardIndex, 1);

      if (isUnit(def) || isMission(def)) {
        // Singular units overlay onto existing stacks with the same title
        const overlayTarget =
          isUnit(def) && isSingular(def) ? findOverlayTarget(player, def) : null;

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
      } else if (def.type === "event") {
        // Resolve event effect
        log.push(`${pLabel} plays event ${cardName(def)}.`);
        resolveEventEffect(s, playerIndex, def, log, undefined);
        player.discard.push(card);
      }

      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        advanceExecutionTurn(s);
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
        baseStack.exhausted = true;
        log.push(`${pLabel} exhausts ${baseDef.title} to use its ability.`);
        resolveBaseAbility(s, playerIndex, baseDef, targetInstanceId, log);
        resetConsecutivePasses(s);
        player.consecutivePasses = 0;
        checkVictory(s, log);
        if (s.phase !== "gameOver") {
          if (s.challenge) {
            advanceChallengeEffectTurn(s);
          } else {
            advanceExecutionTurn(s);
          }
        }
        break;
      }

      // Check alert units (Commit abilities)
      for (const stack of player.zones.alert) {
        const topCard = stack.cards[0];
        if (topCard && topCard.instanceId === sourceInstanceId) {
          const def = getCardDef(topCard.defId);
          if (def.abilityId === "adama-commit") {
            // Commit Adama, give target +2 power
            commitUnit(player, sourceInstanceId);
            log.push(`${pLabel} commits ${cardName(def)} to give a unit +2 power.`);
            if (targetInstanceId) {
              applyPowerBuff(s, targetInstanceId, 2, log);
            }
          }
          resetConsecutivePasses(s);
          player.consecutivePasses = 0;
          checkVictory(s, log);
          if (s.phase !== "gameOver") {
            if (s.challenge) {
              advanceChallengeEffectTurn(s);
            } else {
              advanceExecutionTurn(s);
            }
          }
          break;
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
      resolveMissionEffect(s, playerIndex, def, log);

      // Remove mission from alert and put in discard
      const [missionStack] = player.zones.alert.splice(found.index, 1);
      for (const card of missionStack.cards) {
        player.discard.push(card);
      }

      player.hasResolvedMission = true;
      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
      checkVictory(s, log);
      if (s.phase !== "gameOver") {
        advanceExecutionTurn(s);
      }
      break;
    }

    // --- Execution phase: challenge ---
    case "challenge": {
      const challengerInstanceId = action.challengerInstanceId;
      const challengerDef = findCardDefByInstanceId(s, challengerInstanceId);
      if (!challengerDef) break;

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
        consecutivePasses: 0,
        isCylonChallenge: false,
      };

      resetConsecutivePasses(s);
      player.consecutivePasses = 0;
      // Active player becomes the defender for defend choice
      s.activePlayerIndex = 1 - playerIndex;
      break;
    }

    // --- Defend response ---
    case "defend": {
      if (!s.challenge) break;
      if (action.defenderInstanceId) {
        const defDef = findCardDefByInstanceId(s, action.defenderInstanceId);
        s.challenge.defenderInstanceId = action.defenderInstanceId;
        log.push(`${pLabel} defends with ${defDef?.title ?? "unknown"}.`);
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

      payResourceCost(player, def.cost, bases);
      player.hand.splice(action.cardIndex, 1);

      log.push(`${pLabel} plays ${cardName(def)} during challenge.`);
      resolveEventEffect(s, playerIndex, def, log, action.targetInstanceId);
      player.discard.push(card);

      s.challenge!.consecutivePasses = 0;
      advanceChallengeEffectTurn(s);
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
      player.influence -= 1;
      player.consecutivePasses++;
      log.push(`${pLabel} passes in Cylon phase and loses 1 influence. (Now ${player.influence})`);
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
  }

  s.log.push(...log);
  return { state: s, log };
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
  }

  // Step 3: Wait for draw action
  s.readyStep = 3 as ReadyStep;
  s.activePlayerIndex = s.firstPlayerIndex;
}

function advanceReadyStep4(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  // Check if all players have had their turn at step 4
  if (s.players.every((p) => p.hasPlayedResource)) {
    // Move to step 5
    s.readyStep = 5 as ReadyStep;
    s.activePlayerIndex = s.firstPlayerIndex;
    log.push("Ready phase: reorder unit stacks.");
  } else {
    // Next player
    s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
  }
}

function advanceReadyStep5(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  // Move on: simple for 2 players, just advance
  const nextPlayer = (s.activePlayerIndex + 1) % s.players.length;
  if (nextPlayer === s.firstPlayerIndex) {
    // All done, start execution phase
    startExecutionPhase(s, log);
  } else {
    s.activePlayerIndex = nextPlayer;
  }
}

function startExecutionPhase(s: GameState, log: string[]): void {
  s.phase = "execution";
  s.firstPlayerIndex = determineFirstPlayer(s);
  s.activePlayerIndex = s.firstPlayerIndex;
  for (const player of s.players) {
    player.consecutivePasses = 0;
    player.hasResolvedMission = false;
  }
  log.push("Execution phase begins.");
}

function advanceExecutionTurn(s: GameState): void {
  s.activePlayerIndex = (s.activePlayerIndex + 1) % s.players.length;
}

function startCylonPhase(s: GameState, log: string[], bases: Record<string, BaseCardDef>): void {
  s.phase = "cylon";
  s.firstPlayerIndex = determineFirstPlayer(s);
  s.activePlayerIndex = s.firstPlayerIndex;

  const threatLevel = computeCylonThreatLevel(s);
  log.push(`Cylon phase: threat level is ${threatLevel}, fleet defense is ${s.fleetDefenseLevel}.`);

  if (threatLevel <= s.fleetDefenseLevel) {
    log.push("No Cylon attack this turn.");
    endCylonPhase(s, log, bases);
    return;
  }

  log.push("Cylon attack! Each player reveals a threat.");

  // Each player reveals top card as Cylon threat
  s.cylonThreats = [];
  for (let i = 0; i < s.players.length; i++) {
    const result = revealMysticValue(s.players[i], log, `Player ${i + 1}`);
    const def = getCardDef(result.card.defId);
    const threatPower = def.cylonThreat ?? 0;
    s.cylonThreats.push({
      card: result.card,
      power: threatPower,
      ownerIndex: i,
    });
    log.push(`Player ${i + 1} reveals ${cardName(def)} as Cylon threat (power ${threatPower}).`);
  }

  // Check if all have Cylon trait → fleet jumps (not implementing trait check for boilerplate)
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

  log.push("Cylon phase ends. Turn ends.");
  checkVictory(s, log);
  if (s.phase !== "gameOver") {
    startReadyPhase(s, log, bases);
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

  const challengerPower =
    getUnitPower(challengerStack.stack) + (challenge.challengerPowerBuff ?? 0);

  if (!challenge.defenderInstanceId) {
    // Undefended challenge
    const damage = challengerPower;
    defenderPlayer.influence -= damage;
    log.push(
      `Undefended! Player ${challenge.defenderPlayerIndex + 1} loses ${damage} influence. (Now ${defenderPlayer.influence})`,
    );
    commitUnit(attackerPlayer, challenge.challengerInstanceId);
  } else {
    // Defended challenge — reveal mystic values
    const atkMystic = revealMysticValue(
      attackerPlayer,
      log,
      `Player ${challenge.challengerPlayerIndex + 1}`,
    );
    const defMystic = revealMysticValue(
      defenderPlayer,
      log,
      `Player ${challenge.defenderPlayerIndex + 1}`,
    );

    const atkTotal = challengerPower + atkMystic.value;
    const defenderStack = findUnitInAnyZone(defenderPlayer, challenge.defenderInstanceId);
    const defPower = defenderStack
      ? getUnitPower(defenderStack.stack) + (challenge.defenderPowerBuff ?? 0)
      : 0;
    const defTotal = defPower + defMystic.value;

    log.push(`Challenger total: ${atkTotal} (${challengerPower} + ${atkMystic.value})`);
    log.push(`Defender total: ${defTotal} (${defPower} + ${defMystic.value})`);

    if (atkTotal >= defTotal) {
      // Challenger wins (ties go to challenger)
      log.push("Challenger wins!");
      commitUnit(attackerPlayer, challenge.challengerInstanceId);
      if (defenderStack) {
        defeatUnit(defenderPlayer, challenge.defenderInstanceId, log);
      }
    } else {
      // Defender wins
      log.push("Defender wins!");
      if (defenderStack) {
        commitUnit(defenderPlayer, challenge.defenderInstanceId);
      }
      defeatUnit(attackerPlayer, challenge.challengerInstanceId, log);
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

  const challengerPower =
    getUnitPower(challengerStack.stack) + (challenge.challengerPowerBuff ?? 0);

  // Reveal mystic values
  const atkMystic = revealMysticValue(
    attackerPlayer,
    log,
    `Player ${challenge.challengerPlayerIndex + 1}`,
  );
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

  const atkTotal = challengerPower + atkMystic.value;
  const defTotal = threat.power + defMystic.value;

  log.push(`Challenger total: ${atkTotal} (${challengerPower} + ${atkMystic.value})`);
  log.push(`Cylon threat total: ${defTotal} (${threat.power} + ${defMystic.value})`);

  if (atkTotal >= defTotal) {
    log.push("Challenger defeats the Cylon threat!");
    // Gain influence (2 in 2-player, 1 in 3+ player)
    const gain = s.players.length === 2 ? 2 : 1;
    attackerPlayer.influence += gain;
    log.push(
      `Player ${challenge.challengerPlayerIndex + 1} gains ${gain} influence. (Now ${attackerPlayer.influence})`,
    );
    commitUnit(attackerPlayer, challenge.challengerInstanceId);
    // Put threat into owner's discard
    s.players[threat.ownerIndex].discard.push(threat.card);
    s.cylonThreats.splice(threatIdx, 1);
  } else {
    log.push("Cylon threat wins!");
    defeatUnit(attackerPlayer, challenge.challengerInstanceId, log);
    // Threat remains
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

function defeatUnit(player: PlayerState, instanceId: string, log: string[]): void {
  const found = findUnitInAnyZone(player, instanceId);
  if (found) {
    const def = getCardDef(found.stack.cards[0].defId);
    log.push(`${cardName(def)} is defeated.`);
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
): void {
  if (!cost) return;
  for (const [resType, amount] of Object.entries(cost) as [ResourceType, number][]) {
    let remaining = amount;
    for (const stack of player.zones.resourceStacks) {
      if (remaining <= 0) break;
      if (stack.exhausted) continue;
      if (getStackResourceTypeFromPlayer(stack, bases, player) === resType) {
        stack.exhausted = true;
        remaining -= stackResourceCount(stack);
      }
    }
  }
}

function resetConsecutivePasses(s: GameState): void {
  for (const p of s.players) {
    p.consecutivePasses = 0;
  }
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
  switch (def.abilityId) {
    case "fire-support": {
      if (targetInstanceId) {
        applyPowerBuff(s, targetInstanceId, 2, log);
        log.push("Fire Support: target ship gets +2 power.");
      }
      break;
    }
    case "shuttle-diplomacy": {
      const opp = s.players[1 - playerIndex];
      opp.influence -= 1;
      log.push(`Shuttle Diplomacy: opponent loses 1 influence. (Now ${opp.influence})`);
      break;
    }
    case "condition-one": {
      // Ready all units the player controls (move reserve → alert)
      const player = s.players[playerIndex];
      const toReady = [...player.zones.reserve];
      player.zones.reserve = [];
      player.zones.alert.push(...toReady);
      log.push("Condition One: all units readied.");
      break;
    }
    case "presidential-candidate": {
      if (targetInstanceId) {
        applyPowerBuff(s, targetInstanceId, 1, log);
        log.push("Presidential Candidate: target personnel gets +1 power.");
      }
      break;
    }
    case "outmaneuvered": {
      if (targetInstanceId) {
        applyPowerBuff(s, targetInstanceId, -2, log);
        log.push("Outmaneuvered: target unit gets -2 power.");
      }
      break;
    }
    default:
      log.push(`Event ${cardName(def)} resolved (no special effect implemented).`);
  }
}

function resolveBaseAbility(
  s: GameState,
  playerIndex: number,
  baseDef: BaseCardDef,
  targetInstanceId: string | undefined,
  log: string[],
): void {
  switch (baseDef.abilityId) {
    case "galactica-exhaust": {
      const opp = s.players[1 - playerIndex];
      opp.influence -= 1;
      log.push(`Galactica ability: opponent loses 1 influence. (Now ${opp.influence})`);
      break;
    }
    case "colonial-one-exhaust": {
      const player = s.players[playerIndex];
      player.influence += 1;
      log.push(`Colonial One ability: gain 1 influence. (Now ${player.influence})`);
      break;
    }
  }
}

function resolveMissionEffect(
  s: GameState,
  playerIndex: number,
  def: CardDef,
  log: string[],
): void {
  switch (def.abilityId) {
    case "press-junket": {
      s.players[playerIndex].influence += 2;
      log.push(`Press Junket: gain 2 influence. (Now ${s.players[playerIndex].influence})`);
      break;
    }
    case "investigation": {
      drawCards(s.players[playerIndex], 2, log, `Player ${playerIndex + 1}`);
      log.push("Investigation: draw 2 cards.");
      break;
    }
    default:
      log.push(`Mission ${cardName(def)} resolved (no special effect implemented).`);
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
