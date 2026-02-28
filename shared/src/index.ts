// ============================================================
// BSG CCG — Shared Types
// ============================================================

// --- Resource & Card Types ---

export type ResourceType = "persuasion" | "logistics" | "security";
export type CardType = "personnel" | "ship" | "event" | "mission";

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
  keywords?: string[];
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
}

export interface PlayerZones {
  alert: UnitStack[]; // alert units and missions
  reserve: UnitStack[]; // committed / not-yet-readied units and missions
  resourceStacks: ResourceStack[]; // base + assets + supply cards
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
  consecutivePasses: number; // for step 2 effect round
  challengerPowerBuff?: number; // temporary power modifier
  defenderPowerBuff?: number; // temporary power modifier
  isCylonChallenge: boolean; // true if this is a Cylon phase challenge
  cylonThreatIndex?: number; // index into cylonThreats array
  cylonPlayerIndex?: number; // player acting as "Cylon player"
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
}

export interface GameState {
  players: PlayerState[];
  phase: GamePhase;
  turn: number;
  readyStep: ReadyStep;
  firstPlayerIndex: number;
  activePlayerIndex: number; // whose turn it is to act
  fleetDefenseLevel: number;
  challenge: ChallengeState | null;
  cylonThreats: CylonThreatCard[];
  log: string[];
  winner: number | null; // player index or null
}

// --- Player View (what the client sees) ---

export interface OpponentView {
  zones: PlayerZones; // can see all face-up cards
  handCount: number;
  deckCount: number;
  discardCount: number;
  influence: number;
}

export interface PlayerGameView {
  you: {
    playerIndex: number;
    zones: PlayerZones;
    hand: CardInstance[];
    deckCount: number;
    discardCount: number;
    influence: number;
  };
  opponent: OpponentView;
  phase: GamePhase;
  turn: number;
  readyStep: ReadyStep;
  firstPlayerIndex: number;
  activePlayerIndex: number;
  fleetDefenseLevel: number;
  challenge: ChallengeState | null;
  cylonThreats: CylonThreatCard[];
  log: string[];
  winner: number | null;
}

// --- Game Actions (client → server) ---

export type GameAction =
  | { type: "keepHand" }
  | { type: "redraw" }
  | { type: "drawCards" }
  | { type: "playToResource"; cardIndex: number; asSupply: boolean; targetStackIndex?: number }
  | { type: "passResource" }
  | { type: "doneReorder" }
  | { type: "playCard"; cardIndex: number }
  | { type: "playAbility"; sourceInstanceId: string; targetInstanceId?: string }
  | { type: "resolveMission"; missionInstanceId: string; unitInstanceIds: string[] }
  | { type: "challenge"; challengerInstanceId: string; opponentIndex: number }
  | { type: "defend"; defenderInstanceId: string | null }
  | { type: "challengePass" }
  | { type: "playEventInChallenge"; cardIndex: number; targetInstanceId?: string }
  | { type: "pass" }
  | { type: "challengeCylon"; challengerInstanceId: string; threatIndex: number }
  | { type: "passCylon" };

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
}

// --- WebSocket Messages ---

export interface ActionNotification {
  text: string;
  cardDefIds: string[];
}

export type ClientMessage =
  | { type: "joinGame" }
  | { type: "submitDeck"; baseId: string; deckCardIds: string[] }
  | { type: "action"; action: GameAction }
  | { type: "continue" };

export type ServerMessage =
  | { type: "cardRegistry"; registry: CardRegistry }
  | { type: "deckRequired" }
  | { type: "waitingForOpponent" }
  | {
      type: "gameState";
      state: PlayerGameView;
      validActions: ValidAction[];
      log: string[];
      aiActing?: boolean;
      notification?: ActionNotification;
    }
  | { type: "error"; message: string };

// --- Card Registry Helper ---

/** All card definitions keyed by id — populated by server, sent to client on game start */
export interface CardRegistry {
  cards: Record<string, CardDef>;
  bases: Record<string, BaseCardDef>;
}

// --- Deck Validation (re-export from shared module) ---

export { validateDeck } from "./deckValidation.js";
export type { DeckSubmission, DeckValidationResult } from "./deckValidation.js";
