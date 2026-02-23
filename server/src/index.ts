import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  CardRegistry,
  DeckSubmission,
  BaseCardDef,
  GameState,
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
  const validActions = getValidActions(room.gameState, HUMAN_PLAYER_INDEX, bases);
  sendToPlayer(room.humanWs, {
    type: "gameState",
    state: view,
    validActions,
    log: room.gameState.log.slice(-20),
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

/** Run AI turns until it's the human's turn or game is over */
function processAITurns(room: GameRoom): void {
  if (!room.gameState) return;

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

    try {
      const result = applyAction(room.gameState, AI_PLAYER_INDEX, decision, bases);
      room.gameState = result.state;
    } catch (err) {
      console.error(`AI action error: ${err instanceof Error ? err.message : err}`);
      break;
    }

    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`AI hit max iterations in ${room.id}`);
  }

  // Broadcast final state to human after all AI turns
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

      case "action": {
        const room = playerRoomMap.get(ws);
        if (!room?.gameState) {
          sendToPlayer(ws, { type: "error", message: "Not in a game" });
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
