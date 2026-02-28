import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  CardRegistry,
  DeckSubmission,
  BaseCardDef,
  GameState,
  GameAction,
  ActionNotification,
} from "@bsg/shared";
import { validateDeck } from "@bsg/shared";
import {
  createGame,
  applyAction,
  getValidActions,
  getPlayerView,
  setCardRegistry,
} from "./game-engine.js";
import { loadCardRegistry } from "./cardLoader.js";
import { buildAIDeck } from "./ai-deck.js";
import { makeAIDecision } from "./ai-player.js";

// ============================================================
// BSG CCG — WebSocket Server
// Supports 1 human player vs 1 AI opponent per room.
// ============================================================

// --- Load card registry at startup ---

const registry: CardRegistry = loadCardRegistry();
setCardRegistry(registry.cards);

const bases: Record<string, BaseCardDef> = registry.bases;

console.log(
  `Loaded ${Object.keys(registry.cards).length} cards and ${Object.keys(registry.bases).length} bases`,
);

// --- Server setup ---

const PORT = Number(process.env.PORT) || 3001;
const wss = new WebSocketServer({ port: PORT });

// --- Game Room ---

const AI_PLAYER_INDEX = 1;
const HUMAN_PLAYER_INDEX = 0;

interface GameRoom {
  id: string;
  humanWs: WebSocket | null;
  humanDeck: DeckSubmission | null;
  aiDeck: DeckSubmission | null;
  gameState: GameState | null;
  aiProcessing: boolean;
  pendingNotification: ActionNotification | null;
  continueResolve: (() => void) | null;
}

const rooms: GameRoom[] = [];
const playerRoomMap = new Map<WebSocket, GameRoom>();

function createRoom(ws: WebSocket): GameRoom {
  const room: GameRoom = {
    id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    humanWs: ws,
    humanDeck: null,
    aiDeck: null,
    gameState: null,
    aiProcessing: false,
    pendingNotification: null,
    continueResolve: null,
  };
  rooms.push(room);
  playerRoomMap.set(ws, room);
  return room;
}

function sendToPlayer(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastGameState(room: GameRoom): void {
  if (!room.gameState || !room.humanWs) return;

  const view = getPlayerView(room.gameState, HUMAN_PLAYER_INDEX);
  // Don't show valid actions while AI is stepping through actions
  const validActions = room.aiProcessing
    ? []
    : getValidActions(room.gameState, HUMAN_PLAYER_INDEX, bases);
  sendToPlayer(room.humanWs, {
    type: "gameState",
    state: view,
    validActions,
    log: room.gameState.log.slice(-50),
    aiActing: room.aiProcessing || undefined,
    notification: room.pendingNotification || undefined,
  });
}

function startGame(room: GameRoom): void {
  if (!room.humanDeck || !room.aiDeck) return;

  const humanBase = registry.bases[room.humanDeck.baseId];
  const aiBase = registry.bases[room.aiDeck.baseId];

  room.gameState = createGame(humanBase, [...room.humanDeck.deckCardIds], aiBase, [
    ...room.aiDeck.deckCardIds,
  ]);

  console.log(`Game started in ${room.id}`);
  broadcastGameState(room);

  // AI may need to act first (setup phase — mulligan)
  processAITurns(room);
}

const CONTINUE_TIMEOUT_MS = 30_000;

/** Resolve card definition IDs involved in an AI action (before applying it). */
function resolveActionCardIds(state: GameState, playerIndex: number, action: GameAction): string[] {
  const player = state.players[playerIndex];

  switch (action.type) {
    case "playCard":
    case "playToResource":
    case "playEventInChallenge": {
      const card = player.hand[action.cardIndex];
      return card ? [card.defId] : [];
    }
    case "challenge":
    case "challengeCylon": {
      const id = action.challengerInstanceId;
      return defIdFromInstanceId(state, id);
    }
    case "defend": {
      if (!action.defenderInstanceId) return [];
      return defIdFromInstanceId(state, action.defenderInstanceId);
    }
    case "playAbility": {
      return defIdFromInstanceId(state, action.sourceInstanceId);
    }
    case "resolveMission": {
      return defIdFromInstanceId(state, action.missionInstanceId);
    }
    default:
      return [];
  }
}

/** Find a card's defId by searching all zones for its instanceId. */
function defIdFromInstanceId(state: GameState, instanceId: string): string[] {
  for (const player of state.players) {
    for (const zone of [player.zones.alert, player.zones.reserve]) {
      for (const stack of zone) {
        for (const card of stack.cards) {
          if (card.instanceId === instanceId) return [card.defId];
        }
      }
    }
    for (const rs of player.zones.resourceStacks) {
      if (rs.topCard.instanceId === instanceId) return [rs.topCard.defId];
    }
  }
  return [];
}

/** Wait for the client to send a "continue" message, with a timeout safety. */
function waitForContinue(room: GameRoom): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      room.continueResolve = null;
      resolve();
    }, CONTINUE_TIMEOUT_MS);

    room.continueResolve = () => {
      clearTimeout(timer);
      room.continueResolve = null;
      resolve();
    };
  });
}

/** Run AI turns until it's the human's turn or game is over.
 *  Broadcasts state with a notification modal after each action,
 *  waiting for the human to click "Continue" before proceeding. */
async function processAITurns(room: GameRoom): Promise<void> {
  if (!room.gameState) return;

  room.aiProcessing = true;

  let iterations = 0;
  const MAX_ITERATIONS = 100; // safety limit

  while (room.gameState.phase !== "gameOver" && iterations < MAX_ITERATIONS) {
    const aiActions = getValidActions(room.gameState, AI_PLAYER_INDEX, bases);

    // If AI has no actions, it's not their turn
    if (aiActions.length === 0) break;

    // Check if it's actually the AI's turn to act
    const isAITurn =
      room.gameState.activePlayerIndex === AI_PLAYER_INDEX ||
      // Setup phase is simultaneous — AI mulligans regardless of activePlayerIndex
      room.gameState.phase === "setup" ||
      // During challenge, defender might be AI
      (room.gameState.challenge?.waitingForDefender &&
        room.gameState.challenge.defenderPlayerIndex === AI_PLAYER_INDEX) ||
      // During challenge step 2, AI might need to play effects
      (room.gameState.challenge?.step === 2 &&
        room.gameState.activePlayerIndex === AI_PLAYER_INDEX);

    if (!isAITurn) break;

    const decision = makeAIDecision(room.gameState, AI_PLAYER_INDEX, aiActions, registry);

    // Resolve card IDs before applying action (card may leave hand after)
    const cardDefIds = resolveActionCardIds(room.gameState, AI_PLAYER_INDEX, decision);
    const logLenBefore = room.gameState.log.length;

    try {
      const result = applyAction(room.gameState, AI_PLAYER_INDEX, decision, bases);
      room.gameState = result.state;
    } catch (err) {
      console.error(`AI action error: ${err instanceof Error ? err.message : err}`);
      break;
    }

    iterations++;

    // Build notification from new log entries
    const newEntries = room.gameState.log.slice(logLenBefore);
    const notificationText = newEntries.join("\n");

    if (room.gameState.phase !== "setup" && notificationText) {
      // Show modal and wait for human to click Continue
      room.pendingNotification = { text: notificationText, cardDefIds };
      broadcastGameState(room);
      room.pendingNotification = null;
      await waitForContinue(room);
    } else {
      // Setup phase or no log text — skip modal
      broadcastGameState(room);
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`AI hit max iterations in ${room.id}`);
  }

  room.aiProcessing = false;
  room.pendingNotification = null;

  // Final broadcast with valid actions now available to human
  broadcastGameState(room);
}

// --- Connection handling ---

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendToPlayer(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "joinGame": {
        // Already in a room?
        if (playerRoomMap.has(ws)) {
          const room = playerRoomMap.get(ws)!;
          if (room.gameState) {
            broadcastGameState(room);
          } else {
            sendToPlayer(ws, { type: "cardRegistry", registry });
            sendToPlayer(ws, { type: "deckRequired" });
          }
          return;
        }

        const room = createRoom(ws);
        console.log(`Player joined ${room.id}`);

        // Send card registry so client can build deck
        sendToPlayer(ws, { type: "cardRegistry", registry });
        sendToPlayer(ws, { type: "deckRequired" });
        break;
      }

      case "submitDeck": {
        const room = playerRoomMap.get(ws);
        if (!room) {
          sendToPlayer(ws, { type: "error", message: "Not in a room" });
          return;
        }

        // Validate the submitted deck
        const submission: DeckSubmission = {
          baseId: msg.baseId,
          deckCardIds: msg.deckCardIds,
        };
        const result = validateDeck(submission, registry);
        if (!result.valid) {
          sendToPlayer(ws, {
            type: "error",
            message: `Invalid deck: ${result.errors.join("; ")}`,
          });
          return;
        }

        room.humanDeck = submission;

        // Generate AI deck
        room.aiDeck = buildAIDeck(registry);
        console.log(
          `Decks ready in ${room.id} — human: ${submission.baseId}, AI: ${room.aiDeck.baseId}`,
        );

        // Start the game
        startGame(room);
        break;
      }

      case "continue": {
        const room = playerRoomMap.get(ws);
        if (room?.continueResolve) {
          room.continueResolve();
        }
        break;
      }

      case "action": {
        const room = playerRoomMap.get(ws);
        if (!room?.gameState) {
          sendToPlayer(ws, { type: "error", message: "Not in a game" });
          return;
        }
        if (room.aiProcessing) {
          sendToPlayer(ws, { type: "error", message: "Opponent is still acting" });
          return;
        }

        try {
          const result = applyAction(room.gameState, HUMAN_PLAYER_INDEX, msg.action, bases);
          room.gameState = result.state;
          broadcastGameState(room);

          // Process AI turns after human acts
          processAITurns(room);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          console.error(`Action error: ${errMsg}`);
          sendToPlayer(ws, { type: "error", message: errMsg });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    const room = playerRoomMap.get(ws);
    if (room) {
      playerRoomMap.delete(ws);
      room.humanWs = null;
      console.log(`Player disconnected from ${room.id}`);

      // Clean up empty rooms
      const idx = rooms.indexOf(room);
      if (idx !== -1) rooms.splice(idx, 1);
    }
    console.log("Client disconnected");
  });
});

console.log(`BSG CCG server listening on ws://localhost:${PORT}`);
