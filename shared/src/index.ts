// ============================================================
// BSG CCG — Shared Types
// ============================================================

import type { Keyword } from "./keywords.js";
export type { Keyword };
export { extractKeywords, hasKeyword } from "./keywords.js";

// --- Game Mode ---

export type GameMode = "vs-ai" | "ai-vs-ai" | "vs-player";

// --- Structured Log ---

export interface LogEntry {
  msg: string;
  d?: number; // depth: 0=top-level action, 1=challenge sub-action, 2=resolution detail
  p?: number; // player index (0 or 1)
  cat?: "power" | "flow" | "phase";
}
export type LogItem = string | LogEntry;

// --- Resource & Card Types ---

export type ResourceType = "persuasion" | "logistics" | "security";
export type CardType = "personnel" | "ship" | "event" | "mission";

export type PendingChoiceType =
  // base-abilities
  | "celestra"
  | "blockading-threat"
  | "blockading-player"
  // unit-abilities
  | "space-park-scry"
  | "mining-ship-dig"
  | "boomer-search"
  | "zarek-etb"
  | "astral-queen-second"
  | "tyrol-etb-choice"
  | "tyrol-chief-choice"
  | "six-seductress"
  | "starbuck-reroll"
  | "gaeta-ready-choice"
  | "helo-toaster-choice"
  // event-abilities
  | "godfrey-reveal"
  | "act-of-contrition"
  | "covering-fire-commit"
  | "distraction-commit"
  | "military-coup-exhaust"
  | "painful-recovery-cylon"
  | "suicide-bomber-cylon"
  | "suicide-bomber-target2"
  | "decoys-count"
  | "reformat-count"
  | "setback-target"
  | "setback-exhaust"
  | "endless-task-target"
  | "endless-task-unit"
  | "grounded-choice"
  | "grounded-ship"
  | "hangar-deck-fire-choice"
  | "hangar-deck-fire-ship"
  | "network-hacking-choice"
  | "network-hacking-cylon"
  | "crackdown-discard"
  | "angry-commit"
  | "angry-defeat"
  // mission-abilities
  | "pulling-rank-1"
  | "pulling-rank-2"
  | "assassination-source"
  | "assassination-target"
  | "arrow-of-apollo-search"
  | "life-has-a-melody-search"
  | "hunt-for-tylium-hand"
  | "hunt-for-tylium-stack"
  | "meet-new-boss-hand"
  | "meet-new-boss-field"
  | "article-23"
  | "prophetic-visions-arrange"
  // challenge keywords
  | "manipulate-choice"
  // expedite
  | "expedite-choice"
  // opponent choices
  | "downed-pilot-choice"
  | "still-no-contact-choice"
  // player ship/stack selection
  | "them-or-us-ship"
  | "them-or-us-target"
  | "critical-component-stack"
  // cylon phase
  | "fleet-jump-sacrifice";

export type Trait =
  | "Capital Ship"
  | "Civilian"
  | "Cylon"
  | "Enlisted"
  | "Fighter"
  | "Machine"
  | "Military"
  | "Officer"
  | "Pilot"
  | "Political"
  | "Politician"
  | "Scout"
  | "Transport";

/** Cost to play a card — keys are resource types, values are amounts required */
export type CardCost = { persuasion?: number; logistics?: number; security?: number } | null;

/** Card template definition (static, never mutated at runtime) */
export interface CardDef {
  id: string; // unique card template id, e.g. "raptor-227"
  title?: string; // e.g. "Raptor 227" — not present on event cards
  subtitle?: string; // e.g. "Sharpshooter" — card name for events
  type: CardType;
  image?: string; // path to card image, e.g. "images/cards/BSG1_003-175.jpg"
  set?: string;
  number?: number;
  rarity?: string;
  cost: CardCost; // null = free
  power?: number;
  cylonThreat?: number;
  mysticValue?: number;
  resource?: ResourceType; // what it produces when played as an asset
  traits?: Trait[];
  keywords?: Keyword[];
  resolveText?: string; // mission resolve requirements, e.g. "Resolve: 2 Officers."
  abilityText: string; // display text for the ability
  cylonThreatText?: string; // red text describing cylon threat effect (not on all cards)
  flavorText?: string; // italicized quote text
  abilityId?: string; // machine-readable ability key for engine logic
}

/** Base card definition (not part of deck) */
export interface BaseCardDef {
  id: string;
  title: string;
  image: string; // path to card image, e.g. "images/cards/BSG1_002-175.jpg"
  set: string;
  number: number;
  rarity: string;
  power: number;
  startingInfluence: number;
  handSize: number;
  resource: ResourceType;
  abilityText: string;
  abilityId?: string;
}

/** A runtime card instance — tracks a specific card in play */
export interface CardInstance {
  instanceId: string; // unique per game instance
  defId: string; // references CardDef.id
  faceUp: boolean;
}

// --- Zone Types ---

export interface ResourceStack {
  topCard: CardInstance; // base or asset on top
  supplyCards: CardInstance[]; // face-down supply cards underneath
  exhausted: boolean; // true = spent this turn
}

export interface UnitStack {
  cards: CardInstance[]; // top card is cards[0], rest are overlaid
  exhausted: boolean;
  linkedMissions?: CardInstance[]; // Link missions attached to this unit
  powerBuff?: number; // temporary power modifier from events (cleared end of execution)
}

export interface PlayerZones {
  alert: UnitStack[]; // alert units and missions
  reserve: UnitStack[]; // committed / not-yet-readied units and missions
  resourceStacks: ResourceStack[]; // base + assets + supply cards
  persistentMissions?: CardInstance[]; // resolved persistent missions (face-up in resource area per rules)
}

// --- Game State Types ---

export type GamePhase = "setup" | "ready" | "execution" | "cylon" | "gameOver";

/**
 * Ready phase sub-steps:
 * 1 = ready face-up units/missions from reserve → alert
 * 2 = restore exhausted cards
 * 3 = draw two cards
 * 4 = each player plays card to resource area (or passes)
 * 5 = each player reorders unit stacks
 */
export type ReadyStep = 1 | 2 | 3 | 4 | 5;

export interface ChallengeState {
  challengerInstanceId: string;
  challengerPlayerIndex: number;
  defenderInstanceId: string | null; // null = no defender chosen yet or declined
  defenderPlayerIndex: number;
  step: 1 | 2 | 3 | 4 | 5;
  // step 1: choose challenger + defender
  // step 2: players take turns playing effects
  // step 3: undefended resolution
  // step 4: reveal mystic values
  // step 5: resolve defended challenge
  challengerMysticValue: number | null;
  defenderMysticValue: number | null;
  waitingForDefender: boolean; // true = waiting for defend/decline
  defenderSelector: "challenger" | "defender"; // who picks the defender (Sniper → "challenger")
  consecutivePasses: number; // for step 2 effect round
  challengerPowerBuff?: number; // temporary power modifier
  defenderPowerBuff?: number; // temporary power modifier
  isCylonChallenge: boolean; // true if this is a Cylon phase challenge
  cylonThreatIndex?: number; // index into cylonThreats array
  cylonPlayerIndex?: number; // player acting as "Cylon player"
  pendingTrigger?: { abilityId: string; playerIndex: number; sourceInstanceId?: string }; // Agro Ship/Flattop/Tigh XO pre-defender trigger
  triggerReadiedInstanceId?: string; // unit readied by trigger, commit at challenge end
  losesExhaustedNotDefeated?: boolean; // Dr. Cottle Surgeon: loser exhausted instead of defeated
  doubleMysticReveal?: number; // playerIndex who reveals double mystic (Elosha Priestess / Channel Lords)
  selfDoubleMystic?: number; // Spot Judgment: playerIndex who reveals 2 and picks best
  opponentDoubleMystic?: { controllerIndex: number; opponentIndex: number }; // False Sense of Security
  sixSeductressBuff?: number; // extra power from Six Seductress on undefended challenge
  forceEnd?: boolean; // Cloud 9 Transport Hub / ...Sign: end challenge immediately
  exhaustAtChallengeEnd?: string; // Stims: instanceId to exhaust after challenge
  defeatAtChallengeEnd?: string; // Unwelcome Visitor: instanceId to defeat after challenge
  defenderImmune?: boolean; // Discourage Pursuit: defender not defeated
  defeatChallengerOnWin?: boolean; // Discourage Pursuit: challenger defeated if wins
  // Re-entrant resolveChallenge checkpoints
  resolutionComplete?: boolean; // winner/loser already determined
  sixSeductressChecked?: boolean; // Six Seductress prompt already offered
  manipulateChecked?: boolean; // Manipulate choice already offered
  manipulateChosen?: boolean; // Player chose to use Manipulate (gain influence instead of opponent losing)
  atkMysticRerollChecked?: boolean; // Starbuck reroll already offered for attacker
  defMysticRerollChecked?: boolean; // Starbuck reroll already offered for defender
  tighXoReadied?: string; // instanceId of Tigh readied by challenge trigger
  challengeEndTriggersChecked?: boolean; // optional end-of-challenge triggers already resolved
  sniperDefendAccepted?: boolean; // Sniper two-step: defender accepted, now challenger picks unit
}

export interface CylonThreatCard {
  card: CardInstance;
  power: number; // the Cylon threat value of the revealed card
  ownerIndex: number; // which player's deck it came from
}

export interface PlayerState {
  baseDefId: string; // references BaseCardDef.id
  zones: PlayerZones;
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  influence: number;
  hasMulliganed: boolean;
  hasPlayedResource: boolean; // tracks if player used ready phase step 4
  hasResolvedMission: boolean; // only one per execution phase
  consecutivePasses: number; // for execution phase ending
  ragnarExtraAction?: boolean; // Ragnar Anchorage: skip next turn advance
  ragnarResourceOverride?: boolean; // Ragnar Anchorage: next cost → logistics ≥2 becomes 3 of any type
  oncePerTurnUsed?: Record<string, boolean>; // tracks once-per-turn abilities by abilityId
  temporaryTraitGrants?: Record<string, Trait[]>; // instanceId → granted traits this turn
  temporaryKeywordGrants?: Record<string, Keyword[]>; // instanceId → granted keywords this turn
  temporaryCylonThreatMods?: Record<string, number>; // instanceId → cylon threat modifier this turn
  extraActionsRemaining?: number; // Number Six Agent Provocateur extra actions
  costReduction?: { persuasion?: number; logistics?: number; security?: number }; // Refinery Ship
  temporaryTraitRemovals?: Record<string, string[]>; // instanceId → removed traits (Everyone's Green, Unexpected)
}

export interface GameState {
  players: PlayerState[];
  playerNames: [string, string];
  phase: GamePhase;
  turn: number;
  readyStep: ReadyStep;
  firstPlayerIndex: number;
  activePlayerIndex: number; // whose turn it is to act
  fleetDefenseLevel: number;
  challenge: ChallengeState | null;
  cylonThreats: CylonThreatCard[];
  log: LogItem[];
  winner: number | null; // player index or null
  preventInfluenceLoss?: boolean; // Executive Privilege: prevent all influence loss this phase
  preventInfluenceGain?: boolean; // Standoff: prevent all influence gain this phase
  noChallenges?: boolean; // Showdown: no challenges rest of phase
  politiciansCantDefend?: boolean; // Martial Law: politicians can't defend this phase
  skipEventDiscard?: boolean; // Top Off the Tank: event doesn't go to discard
  pendingChoice?: {
    type: PendingChoiceType;
    playerIndex: number;
    cards: CardInstance[]; // revealed cards to choose between
    context?: Record<string, unknown>; // ability-specific state (targetId, sourceId, etc.)
    prompt?: string; // UI header text for the choice
  };
  extraPhases?: string[]; // queued extra phases (False Peace)
  forceEndExecution?: boolean; // skip to Cylon phase immediately (False Peace)
  effectImmunity?: Record<string, "power" | "all">; // instanceId → immunity type (Anti-Radiation / Fallout Shelter)
  cylonPhaseFirstOverride?: number; // Cylon Betrayal: force this player as first in next Cylon phase
  cylonThreatImmunity?: { threatIndex: number; playerIndex: number }; // threat text skips this player for this threat
  cylonPhaseResumeNeeded?: boolean; // cylon phase paused for player choice, needs resume after
  fleetJumpPending?: boolean; // fleet jump sacrifice in progress — discard threats + end phase after
}

// --- Player View (what the client sees) ---

export interface OpponentView {
  zones: PlayerZones; // can see all face-up cards
  handCount: number;
  deckCount: number;
  discardCount: number;
  discard: CardInstance[]; // rules: "Cards in discard piles can be viewed"
  influence: number;
}

export interface PlayerGameView {
  you: {
    playerIndex: number;
    zones: PlayerZones;
    hand: CardInstance[];
    deckCount: number;
    discardCount: number;
    discard: CardInstance[]; // your own discard pile
    influence: number;
  };
  opponent: OpponentView;
  playerNames: [string, string];
  phase: GamePhase;
  turn: number;
  readyStep: ReadyStep;
  firstPlayerIndex: number;
  activePlayerIndex: number;
  fleetDefenseLevel: number;
  challenge: ChallengeState | null;
  cylonThreats: CylonThreatCard[];
  log: LogItem[];
  winner: number | null;
  traitGrants?: Record<string, Trait[]>; // instanceId → temporary traits granted this turn
  choicePrompt?: string; // context-specific header for pending choice UI
  choiceType?: PendingChoiceType; // type of pending choice, for client-side conditional rendering
}

// --- Game Actions (client → server) ---

export type GameAction =
  | { type: "keepHand" }
  | { type: "redraw" }
  | { type: "drawCards" }
  | { type: "playToResource"; cardIndex: number; asSupply: boolean; targetStackIndex?: number }
  | { type: "passResource" }
  | { type: "doneReorder" }
  | {
      type: "playCard";
      cardIndex: number;
      targetInstanceId?: string;
      selectedStackIndices?: number[];
    }
  | { type: "playAbility"; sourceInstanceId: string; targetInstanceId?: string }
  | {
      type: "resolveMission";
      missionInstanceId: string;
      unitInstanceIds: string[];
      targetInstanceId?: string;
      linkTargetInstanceId?: string;
    }
  | { type: "challenge"; challengerInstanceId: string; opponentIndex: number }
  | { type: "defend"; defenderInstanceId: string | null }
  | { type: "sniperAccept"; accept: boolean } // Sniper: defender accepts/declines defense
  | { type: "challengePass" }
  | {
      type: "playEventInChallenge";
      cardIndex: number;
      targetInstanceId?: string;
      selectedStackIndices?: number[];
    }
  | { type: "pass" }
  | { type: "challengeCylon"; challengerInstanceId: string; threatIndex: number }
  | { type: "passCylon" }
  | { type: "useTriggeredAbility"; targetInstanceId?: string }
  | { type: "declineTrigger" }
  | { type: "makeChoice"; choiceIndex: number }
  | { type: "strafeChoice"; challengeAs: "personnel" | "ship" }
  | { type: "sacrificeFromStack"; stackInstanceId: string; cardInstanceId: string }
  | { type: "reorderStack"; stackInstanceId: string; newTopDefId: string };

// --- Valid Actions (server → client) ---

export interface ValidAction {
  type: GameAction["type"];
  description: string;
  cardDefId?: string; // card definition ID for thumbnail display
  disabled?: boolean; // shown but not clickable (e.g. can't afford)
  // Optional context for the UI to know what's selectable
  selectableCardIndices?: number[]; // hand indices
  selectableInstanceIds?: string[]; // board card instance IDs
  selectableStackIndices?: number[]; // resource stack indices
  selectableThreatIndices?: number[]; // cylon threat indices
  sourceInstanceId?: string; // pre-selected source for ability actions (e.g. linked mission unit)
  targetInstanceId?: string; // pre-selected target for ability actions
  missionTargetIds?: string[]; // valid resolve-time targets for missions
  linkTargetIds?: string[]; // valid link attachment targets for missions
  abilityIndex?: number; // for dual-ability cards (e.g. Baltar VP: 0 or 1)
  targetPrompt?: string; // custom prompt for target selection
}

// --- WebSocket Messages ---

export interface ActionNotification {
  text: string;
  cardDefIds: string[];
}

// --- Debug / Test Scenario ---

export interface DebugPlayerSetup {
  baseId: string;
  hand?: string[]; // card defIds to place in hand
  alert?: string[]; // card defIds to place in alert zone (each as a single-card UnitStack)
  reserve?: string[]; // card defIds to place in reserve zone
  deck?: string[]; // card defIds to place in deck (top-first order)
  assets?: string[]; // card defIds to add as extra resource stacks (assets)
  baseSupplyCards?: number; // number of supply cards to add under the base stack
  influence?: number; // override starting influence
}

export interface DebugScenario {
  player0: DebugPlayerSetup;
  player1: DebugPlayerSetup;
  phase?: GamePhase; // default: "execution"
  turn?: number; // default: 3
  activePlayerIndex?: number; // default: 0
}

export type ClientMessage =
  | { type: "joinGame"; roomId?: string; mode?: GameMode; joinCode?: string; playerName?: string }
  | { type: "submitDeck"; baseId: string; deckCardIds: string[] }
  | { type: "action"; action: GameAction }
  | { type: "continue" }
  | { type: "resetGame" }
  | { type: "debugSetup"; scenario: DebugScenario };

export type ServerMessage =
  | { type: "cardRegistry"; registry: CardRegistry }
  | { type: "deckRequired" }
  | { type: "waitingForOpponent" }
  | { type: "gameSetup"; mode: GameMode; joinCode?: string }
  | {
      type: "gameState";
      state: PlayerGameView;
      validActions: ValidAction[];
      log: LogItem[];
      aiActing?: boolean;
      notification?: ActionNotification;
    }
  | { type: "error"; message: string }
  | { type: "joined"; roomId: string };

// --- Card Registry Helper ---

/** All card definitions keyed by id — populated by server, sent to client on game start */
export interface CardRegistry {
  cards: Record<string, CardDef>;
  bases: Record<string, BaseCardDef>;
}

// --- Deck Validation (re-export from shared module) ---

export { validateDeck } from "./deckValidation.js";
export type { DeckSubmission, DeckValidationResult } from "./deckValidation.js";
