import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  CardRegistry,
  DeckSubmission,
  BaseCardDef,
  GameState,
  GameAction,
  GameMode,
  ActionNotification,
  ValidAction,
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
// Supports: Human vs AI, AI vs AI (spectate), Human vs Human
// ============================================================

// --- Load card registry at startup ---

const registry: CardRegistry = loadCardRegistry();
setCardRegistry(registry.cards, registry.bases);

const bases: Record<string, BaseCardDef> = registry.bases;

console.log(
  `Loaded ${Object.keys(registry.cards).length} cards and ${Object.keys(registry.bases).length} bases`,
);

// --- Server setup ---

const PORT = Number(process.env.PORT) || 3001;
const wss = new WebSocketServer({ port: PORT });

// --- Game Room ---

interface PlayerSlot {
  type: "human" | "ai";
  ws: WebSocket | null; // null for AI players
  deck: DeckSubmission | null;
}

interface GameRoom {
  id: string;
  mode: GameMode;
  joinCode: string; // short code for PvP room sharing
  players: [PlayerSlot, PlayerSlot];
  spectators: WebSocket[]; // for AI-vs-AI viewers
  gameState: GameState | null;
  aiProcessing: boolean;
  pendingNotification: ActionNotification | null;
  continueResolve: (() => void) | null;
  /** Incremented on each game start/reset so stale processAITurns loops can detect they're outdated. */
  gameGeneration: number;
}

const ROOM_CLEANUP_MS = 5 * 60 * 1000;

const rooms: GameRoom[] = [];
const roomsById = new Map<string, GameRoom>();
const roomsByJoinCode = new Map<string, GameRoom>();
const wsRoomMap = new Map<WebSocket, GameRoom>();
const wsPlayerIndex = new Map<WebSocket, number>(); // -1 = spectator
const roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let code: string;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (roomsByJoinCode.has(code));
  return code;
}

function createRoom(mode: GameMode): GameRoom {
  const isVsAi = mode === "vs-ai";
  const isAiVsAi = mode === "ai-vs-ai";

  const room: GameRoom = {
    id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mode,
    joinCode: generateJoinCode(),
    players: [
      { type: isAiVsAi ? "ai" : "human", ws: null, deck: null },
      { type: isVsAi || isAiVsAi ? "ai" : "human", ws: null, deck: null },
    ],
    spectators: [],
    gameState: null,
    aiProcessing: false,
    pendingNotification: null,
    continueResolve: null,
    gameGeneration: 0,
  };
  rooms.push(room);
  roomsById.set(room.id, room);
  roomsByJoinCode.set(room.joinCode, room);
  return room;
}

function destroyRoom(room: GameRoom): void {
  // Bump generation and resolve any pending AI await so the loop exits cleanly
  room.gameGeneration++;
  if (room.continueResolve) room.continueResolve();

  const idx = rooms.indexOf(room);
  if (idx !== -1) rooms.splice(idx, 1);
  roomsById.delete(room.id);
  roomsByJoinCode.delete(room.joinCode);
  for (const slot of room.players) {
    if (slot.ws) {
      wsRoomMap.delete(slot.ws);
      wsPlayerIndex.delete(slot.ws);
    }
  }
  for (const ws of room.spectators) {
    wsRoomMap.delete(ws);
    wsPlayerIndex.delete(ws);
  }
  const timer = roomCleanupTimers.get(room.id);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(room.id);
  }
}

function assignWsToRoom(ws: WebSocket, room: GameRoom, playerIdx: number): void {
  wsRoomMap.set(ws, room);
  wsPlayerIndex.set(ws, playerIdx);
  if (playerIdx >= 0) {
    room.players[playerIdx].ws = ws;
  } else {
    room.spectators.push(ws);
  }
  // Cancel any pending cleanup
  const timer = roomCleanupTimers.get(room.id);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(room.id);
  }
}

function sendToPlayer(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Send appropriate game view to all connected humans + spectators. */
function broadcastGameState(room: GameRoom): void {
  if (!room.gameState) return;

  for (let i = 0; i < 2; i++) {
    const slot = room.players[i];
    if (slot.type === "human" && slot.ws) {
      const view = getPlayerView(room.gameState, i);
      let validActions: ValidAction[];
      try {
        validActions = room.aiProcessing ? [] : getValidActions(room.gameState, i, bases);
      } catch (err) {
        console.error(`getValidActions failed for player ${i} in ${room.id}:`, err);
        validActions = [];
      }
      sendToPlayer(slot.ws, {
        type: "gameState",
        state: view,
        validActions,
        log: room.gameState.log.slice(-50),
        aiActing: room.aiProcessing || undefined,
        notification: room.pendingNotification || undefined,
      });
    }
  }

  // Spectators see player 0's perspective but with no valid actions
  for (const ws of room.spectators) {
    const view = getPlayerView(room.gameState, 0);
    sendToPlayer(ws, {
      type: "gameState",
      state: view,
      validActions: [],
      log: room.gameState.log.slice(-50),
      aiActing: room.aiProcessing || undefined,
      notification: room.pendingNotification || undefined,
    });
  }
}

function allDecksReady(room: GameRoom): boolean {
  return room.players.every((slot) => slot.deck !== null);
}

function startGame(room: GameRoom): void {
  const deck0 = room.players[0].deck!;
  const deck1 = room.players[1].deck!;
  const base0 = registry.bases[deck0.baseId];
  const base1 = registry.bases[deck1.baseId];

  room.gameGeneration++;
  room.gameState = createGame(base0, [...deck0.deckCardIds], base1, [...deck1.deckCardIds]);

  console.log(`Game started in ${room.id} (${room.mode})`);
  broadcastGameState(room);

  // Process any AI turns (setup phase mulligan, etc.)
  const gen = room.gameGeneration;
  processAITurns(room).catch((err) => {
    console.error(`AI processing error in ${room.id}:`, err);
    // Only recover if this is still the active game — stale loops should just exit
    if (room.gameGeneration === gen) {
      room.aiProcessing = false;
      room.pendingNotification = null;
      if (room.gameState) {
        room.gameState.log.push(
          `[Engine error: ${err instanceof Error ? err.message : String(err)}]`,
        );
      }
      try {
        broadcastGameState(room);
      } catch (broadcastErr) {
        console.error(`broadcastGameState also failed in ${room.id}:`, broadcastErr);
      }
    }
  });
}

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

/** Check if the given player index can act right now. */
function canPlayerAct(state: GameState, playerIndex: number): boolean {
  if (state.phase === "setup") return true; // simultaneous mulligan
  if (state.pendingChoice?.playerIndex === playerIndex) return true;
  if (state.activePlayerIndex === playerIndex) return true;
  if (state.challenge?.waitingForDefender && state.challenge.defenderPlayerIndex === playerIndex)
    return true;
  if (state.challenge?.step === 2 && state.activePlayerIndex === playerIndex) return true;
  return false;
}

/** Wait for any connected human (player or spectator) to send "continue". */
function waitForContinue(room: GameRoom): Promise<void> {
  return new Promise((resolve) => {
    room.continueResolve = () => {
      room.continueResolve = null;
      resolve();
    };
  });
}

/** Has at least one human viewer (player or spectator) connected? */
function hasHumanViewer(room: GameRoom): boolean {
  for (const slot of room.players) {
    if (slot.type === "human" && slot.ws) return true;
  }
  if (room.spectators.length > 0) return true;
  return false;
}

/** Run AI turns until a human player needs to act or game is over.
 *  Broadcasts state with a notification modal after each action,
 *  waiting for a human to click "Continue" before proceeding.
 *
 *  Captures gameGeneration at start and exits cleanly if the room
 *  is reset or destroyed while this loop is awaiting. */
async function processAITurns(room: GameRoom): Promise<void> {
  if (!room.gameState) return;

  const gen = room.gameGeneration;
  room.aiProcessing = true;

  let iterations = 0;
  const MAX_ITERATIONS = 200; // higher for ai-vs-ai which runs full games

  while (room.gameState && room.gameState.phase !== "gameOver" && iterations < MAX_ITERATIONS) {
    // Find an AI player that can act
    let aiIdx = -1;
    let aiActions: ValidAction[] = [];

    for (let i = 0; i < 2; i++) {
      if (room.players[i].type !== "ai") continue;
      if (!canPlayerAct(room.gameState, i)) continue;
      let actions: ValidAction[];
      try {
        actions = getValidActions(room.gameState, i, bases);
      } catch (err) {
        console.error(
          `getValidActions failed for AI player ${i} in ${room.id} (phase: ${room.gameState.phase}):`,
          err,
        );
        break;
      }
      if (actions.length > 0) {
        aiIdx = i;
        aiActions = actions;
        break;
      }
    }

    if (aiIdx === -1 || aiActions.length === 0) break;

    const decision = makeAIDecision(room.gameState, aiIdx, aiActions, registry);

    // Resolve card IDs before applying action (card may leave hand after)
    const cardDefIds = resolveActionCardIds(room.gameState, aiIdx, decision);
    const logLenBefore = room.gameState.log.length;

    try {
      const result = applyAction(room.gameState, aiIdx, decision, bases);
      room.gameState = result.state;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const phase = room.gameState.phase;
      const actionType = decision.type;
      console.error(
        `AI action error in ${room.id} [phase=${phase}, action=${actionType}, player=${aiIdx}]: ${errMsg}`,
      );
      // Append error to game log so it's visible to the player
      room.gameState.log.push(`[Engine error during AI ${actionType}: ${errMsg}]`);
      break;
    }

    iterations++;

    // Build notification from new log entries
    const newEntries = room.gameState.log.slice(logLenBefore);
    const notificationText = newEntries.join("\n");

    if (room.gameState.phase !== "setup" && notificationText && hasHumanViewer(room)) {
      // Show modal and wait for human to click Continue
      room.pendingNotification = { text: notificationText, cardDefIds };
      broadcastGameState(room);
      room.pendingNotification = null;
      await waitForContinue(room);

      // After await: check if room was reset/destroyed while we were waiting
      if (room.gameGeneration !== gen) return;
    } else {
      broadcastGameState(room);
    }
  }

  // Only clean up if we're still the active generation
  if (room.gameGeneration !== gen) return;

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`AI hit max iterations in ${room.id}`);
  }

  room.aiProcessing = false;
  room.pendingNotification = null;

  // Final broadcast with valid actions now available
  broadcastGameState(room);
}

// --- Connection handling ---

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

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
        // If client explicitly wants a new game (has mode or joinCode), leave old room first
        if (wsRoomMap.has(ws) && (msg.mode || msg.joinCode)) {
          const oldRoom = wsRoomMap.get(ws)!;
          const oldIdx = wsPlayerIndex.get(ws);
          if (oldIdx !== undefined && oldIdx >= 0) {
            oldRoom.players[oldIdx].ws = null;
          } else {
            const specIdx = oldRoom.spectators.indexOf(ws);
            if (specIdx !== -1) oldRoom.spectators.splice(specIdx, 1);
          }
          wsRoomMap.delete(ws);
          wsPlayerIndex.delete(ws);
          console.log(`Player left ${oldRoom.id} to start new game`);
        }

        // Already in a room via this WebSocket? (reconnection — no mode/joinCode)
        if (wsRoomMap.has(ws)) {
          const room = wsRoomMap.get(ws)!;
          const pIdx = wsPlayerIndex.get(ws) ?? -1;
          sendToPlayer(ws, { type: "joined", roomId: room.id });
          sendToPlayer(ws, { type: "cardRegistry", registry });
          if (room.gameState) {
            broadcastGameState(room);
          } else if (pIdx >= 0 && room.players[pIdx].type === "human") {
            sendToPlayer(ws, { type: "deckRequired" });
          }
          return;
        }

        // --- Joining an existing PvP room by join code ---
        if (msg.joinCode) {
          const code = msg.joinCode.toUpperCase();
          const existing = roomsByJoinCode.get(code);
          if (!existing) {
            sendToPlayer(ws, { type: "error", message: `Room not found: ${code}` });
            return;
          }
          if (existing.mode !== "vs-player") {
            sendToPlayer(ws, { type: "error", message: "That room is not a PvP game" });
            return;
          }
          // Find an open human slot
          const openIdx = existing.players.findIndex((s) => s.type === "human" && !s.ws);
          if (openIdx === -1) {
            sendToPlayer(ws, { type: "error", message: "Room is full" });
            return;
          }
          assignWsToRoom(ws, existing, openIdx);
          console.log(`Player 2 joined PvP room ${existing.id} (code ${code})`);
          sendToPlayer(ws, { type: "joined", roomId: existing.id });
          sendToPlayer(ws, { type: "cardRegistry", registry });
          if (existing.gameState) {
            broadcastGameState(existing);
          } else {
            sendToPlayer(ws, { type: "deckRequired" });
          }
          return;
        }

        // --- Reconnection by roomId ---
        if (msg.roomId) {
          const existing = roomsById.get(msg.roomId);
          if (existing) {
            // Find which slot this player was in
            let reconnectedIdx = -1;
            for (let i = 0; i < 2; i++) {
              if (existing.players[i].type === "human" && !existing.players[i].ws) {
                reconnectedIdx = i;
                break;
              }
            }
            // Could also be a spectator reconnecting
            if (reconnectedIdx === -1 && existing.mode === "ai-vs-ai") {
              reconnectedIdx = -1; // spectator
            }

            if (reconnectedIdx >= 0) {
              assignWsToRoom(ws, existing, reconnectedIdx);
            } else {
              // Spectator reconnect
              assignWsToRoom(ws, existing, -1);
            }

            console.log(`Player reconnected to ${existing.id}`);
            sendToPlayer(ws, { type: "joined", roomId: existing.id });
            sendToPlayer(ws, { type: "cardRegistry", registry });
            if (existing.gameState) {
              broadcastGameState(existing);
            } else if (reconnectedIdx >= 0 && existing.players[reconnectedIdx].type === "human") {
              sendToPlayer(ws, { type: "deckRequired" });
            }
            return;
          }
          console.log(`Room ${msg.roomId} not found, creating new room`);
        }

        // --- Create new room ---
        const mode: GameMode = msg.mode ?? "vs-ai";
        const room = createRoom(mode);

        if (mode === "ai-vs-ai") {
          // Human is a spectator, not a player
          assignWsToRoom(ws, room, -1);
        } else {
          // Human is player 0
          assignWsToRoom(ws, room, 0);
        }

        console.log(`Player joined ${room.id} (mode: ${mode}, code: ${room.joinCode})`);

        sendToPlayer(ws, { type: "joined", roomId: room.id });
        sendToPlayer(ws, { type: "cardRegistry", registry });

        if (mode === "ai-vs-ai") {
          // Generate both AI decks and start immediately
          room.players[0].deck = buildAIDeck(registry);
          room.players[1].deck = buildAIDeck(registry);
          console.log(
            `AI decks ready in ${room.id} — P1: ${room.players[0].deck.baseId}, P2: ${room.players[1].deck.baseId}`,
          );
          startGame(room);
        } else if (mode === "vs-player") {
          // Send join code so player 1 can share it; client will start deck builder from there
          sendToPlayer(ws, { type: "gameSetup", mode, joinCode: room.joinCode });
        } else {
          // vs-ai: just show deck builder
          sendToPlayer(ws, { type: "deckRequired" });
        }
        break;
      }

      case "submitDeck": {
        const room = wsRoomMap.get(ws);
        const pIdx = wsPlayerIndex.get(ws);
        if (!room || pIdx === undefined || pIdx < 0) {
          sendToPlayer(ws, { type: "error", message: "Not in a room as a player" });
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

        room.players[pIdx].deck = submission;
        console.log(`Player ${pIdx} submitted deck in ${room.id} (base: ${submission.baseId})`);

        // For vs-ai: generate AI deck for the other slot
        if (room.mode === "vs-ai") {
          const aiIdx = pIdx === 0 ? 1 : 0;
          room.players[aiIdx].deck = buildAIDeck(registry);
          console.log(`AI deck ready in ${room.id} — AI: ${room.players[aiIdx].deck.baseId}`);
        }

        // Check if all decks are ready
        if (allDecksReady(room)) {
          startGame(room);
        } else {
          // PvP: waiting for opponent's deck
          sendToPlayer(ws, { type: "waitingForOpponent" });
        }
        break;
      }

      case "continue": {
        const room = wsRoomMap.get(ws);
        if (room?.continueResolve) {
          room.continueResolve();
        }
        break;
      }

      case "resetGame": {
        const room = wsRoomMap.get(ws);
        if (!room) {
          sendToPlayer(ws, { type: "error", message: "Not in a room" });
          return;
        }
        // Bump generation first so any in-flight processAITurns detects staleness
        room.gameGeneration++;
        // Resolve pending continueResolve so the old AI loop unblocks and can exit
        if (room.continueResolve) room.continueResolve();
        room.gameState = null;
        room.players[0].deck = null;
        room.players[1].deck = null;
        room.aiProcessing = false;
        room.pendingNotification = null;
        console.log(`Game reset in ${room.id}`);

        if (room.mode === "ai-vs-ai") {
          // Re-generate AI decks and restart
          room.players[0].deck = buildAIDeck(registry);
          room.players[1].deck = buildAIDeck(registry);
          startGame(room);
        } else {
          // Tell all human players to rebuild decks
          for (const slot of room.players) {
            if (slot.type === "human" && slot.ws) {
              sendToPlayer(slot.ws, { type: "deckRequired" });
            }
          }
        }
        break;
      }

      case "action": {
        const room = wsRoomMap.get(ws);
        const pIdx = wsPlayerIndex.get(ws);
        if (!room?.gameState || pIdx === undefined || pIdx < 0) {
          sendToPlayer(ws, { type: "error", message: "Not in a game as a player" });
          return;
        }
        if (room.aiProcessing) {
          sendToPlayer(ws, { type: "error", message: "Opponent is still acting" });
          return;
        }

        try {
          const result = applyAction(room.gameState, pIdx, msg.action, bases);
          room.gameState = result.state;
          broadcastGameState(room);

          // Process AI turns after human acts
          const gen = room.gameGeneration;
          processAITurns(room).catch((err) => {
            console.error(`AI processing error in ${room.id}:`, err);
            if (room.gameGeneration === gen) {
              room.aiProcessing = false;
              room.pendingNotification = null;
              if (room.gameState) {
                room.gameState.log.push(
                  `[Engine error: ${err instanceof Error ? err.message : String(err)}]`,
                );
              }
              try {
                broadcastGameState(room);
              } catch (broadcastErr) {
                console.error(`broadcastGameState also failed in ${room.id}:`, broadcastErr);
              }
            }
          });
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
    const room = wsRoomMap.get(ws);
    if (room) {
      const pIdx = wsPlayerIndex.get(ws);

      // Remove from player slot or spectator list
      if (pIdx !== undefined && pIdx >= 0) {
        room.players[pIdx].ws = null;
      } else {
        const specIdx = room.spectators.indexOf(ws);
        if (specIdx !== -1) room.spectators.splice(specIdx, 1);
      }

      wsRoomMap.delete(ws);
      wsPlayerIndex.delete(ws);

      console.log(`Player disconnected from ${room.id}`);

      // Check if any humans are still connected
      const anyConnected = room.players.some((s) => s.ws !== null) || room.spectators.length > 0;

      if (!anyConnected) {
        // Keep the room alive for reconnection; destroy after timeout
        const timer = setTimeout(() => {
          roomCleanupTimers.delete(room.id);
          destroyRoom(room);
          console.log(`Room ${room.id} cleaned up after timeout`);
        }, ROOM_CLEANUP_MS);
        roomCleanupTimers.set(room.id, timer);
      }
    }
    console.log("Client disconnected");
  });
});

// --- Global error handlers (prevent server crash from killing all games) ---

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

console.log(`BSG CCG server listening on ws://localhost:${PORT}`);
