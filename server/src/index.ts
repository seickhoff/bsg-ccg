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
  createDebugGame,
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
const wss = new WebSocketServer({ port: PORT, perMessageDeflate: false });

// --- WebSocket heartbeat (keeps connections alive through proxies) ---

const HEARTBEAT_MS = 30_000;

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if ((ws as any).isAlive === false) {
      (ws as any).heartbeatMisses = ((ws as any).heartbeatMisses ?? 0) + 1;
      if ((ws as any).heartbeatMisses >= 2) {
        console.log("Terminating unresponsive WebSocket (missed 2 pongs)");
        ws.terminate();
        continue;
      }
    } else {
      (ws as any).heartbeatMisses = 0;
    }
    (ws as any).isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

// --- Game Room ---

interface PlayerSlot {
  type: "human" | "ai";
  ws: WebSocket | null; // null for AI players
  deck: DeckSubmission | null;
  name: string;
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
  /** Track how many log entries have been broadcast so we only send new ones */
  lastBroadcastLogLen: number;
  /** Timestamp of last player action or broadcast — used for stale-turn resync */
  lastActivityMs: number;
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
      { type: isAiVsAi ? "ai" : "human", ws: null, deck: null, name: isAiVsAi ? "Spectre" : "" },
      {
        type: isVsAi || isAiVsAi ? "ai" : "human",
        ws: null,
        deck: null,
        name: isVsAi || isAiVsAi ? "Spectre" : "",
      },
    ],
    spectators: [],
    gameState: null,
    aiProcessing: false,
    pendingNotification: null,
    continueResolve: null,
    gameGeneration: 0,
    lastBroadcastLogLen: 0,
    lastActivityMs: Date.now(),
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
  } else {
    const roomId = wsRoomMap.get(ws)?.id;
    const pIdx = wsPlayerIndex.get(ws);
    console.warn(
      `[WS] Dropped ${msg.type} — readyState=${ws.readyState}` +
        (roomId ? ` room=${roomId}` : "") +
        (pIdx !== undefined ? ` player=${pIdx}` : ""),
    );
  }
}

/** Send appropriate game view to all connected humans + spectators. */
function broadcastGameState(room: GameRoom): void {
  if (!room.gameState) return;
  room.lastActivityMs = Date.now();

  // Keep game-state player names in sync with room player names
  for (let i = 0; i < 2; i++) {
    const name = room.players[i].name;
    if (name) room.gameState.playerNames[i as 0 | 1] = name;
  }

  const newLogEntries = room.gameState.log.slice(room.lastBroadcastLogLen);
  room.lastBroadcastLogLen = room.gameState.log.length;

  // Filter log entries by player — entries with p set are private to that player
  const filterLogForPlayer = (entries: typeof newLogEntries, playerIndex: number) =>
    entries.filter((e) => typeof e === "string" || e.p === undefined || e.p === playerIndex);

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
      // Build per-player notification if log range is available (filters private entries)
      let notification = room.pendingNotification || undefined;
      if (
        notification?.logStart !== undefined &&
        notification?.logEnd !== undefined &&
        room.gameState
      ) {
        const filtered = filterLogForPlayer(
          room.gameState.log.slice(notification.logStart, notification.logEnd),
          i,
        );
        const text = filtered.map((e) => (typeof e === "string" ? e : e.msg)).join("\n");
        notification = { ...notification, text };
      }
      sendToPlayer(slot.ws, {
        type: "gameState",
        state: view,
        validActions,
        log: filterLogForPlayer(newLogEntries, i),
        aiActing: room.aiProcessing || undefined,
        notification,
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
      log: filterLogForPlayer(newLogEntries, 0),
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
  room.lastBroadcastLogLen = 0;
  const playerNames: [string, string] = [
    room.players[0].name || "Player 1",
    room.players[1].name || "Player 2",
  ];
  room.gameState = createGame(
    base0,
    [...deck0.deckCardIds],
    base1,
    [...deck1.deckCardIds],
    playerNames,
  );

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
async function processAITurns(room: GameRoom, logStartFrom?: number): Promise<void> {
  if (!room.gameState) return;

  const gen = room.gameGeneration;
  room.aiProcessing = true;

  let iterations = 0;
  const MAX_ITERATIONS = 200; // higher for ai-vs-ai which runs full games

  // Accumulate log entries across AI iterations so the popup shows
  // everything the AI did (e.g. committed cards + pass) in one view.
  // logStartFrom lets callers include log entries from the preceding human action.
  let accumulatedLogStart = logStartFrom ?? room.gameState.log.length;
  let accumulatedCardDefIds: string[] = [];

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
    accumulatedCardDefIds.push(...cardDefIds);

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

    // Check if there are more AI actions coming — if so, keep accumulating
    let moreAiActions = false;
    if (room.gameState.phase !== "gameOver") {
      for (let i = 0; i < 2; i++) {
        if (room.players[i].type !== "ai") continue;
        if (!canPlayerAct(room.gameState, i)) continue;
        try {
          const actions = getValidActions(room.gameState, i, bases);
          if (actions.length > 0) {
            moreAiActions = true;
            break;
          }
        } catch {
          // ignore — will be caught on next iteration
        }
      }
    }

    if (moreAiActions) {
      // More AI actions coming — keep accumulating, just broadcast state
      broadcastGameState(room);
      continue;
    }

    // No more AI actions — show accumulated notification
    const allNewEntries = room.gameState.log.slice(accumulatedLogStart);
    const notificationText = allNewEntries
      .map((e) => (typeof e === "string" ? e : e.msg))
      .join("\n");

    if (room.gameState.phase !== "setup" && notificationText && hasHumanViewer(room)) {
      // Show modal and wait for human to click Continue
      room.pendingNotification = {
        text: notificationText,
        cardDefIds: accumulatedCardDefIds,
        logStart: accumulatedLogStart,
        logEnd: room.gameState.log.length,
      };
      broadcastGameState(room);
      await waitForContinue(room);
      room.pendingNotification = null;

      // After await: check if room was reset/destroyed while we were waiting
      if (room.gameGeneration !== gen) return;
    } else {
      broadcastGameState(room);
    }

    // Reset accumulation for next batch
    accumulatedLogStart = room.gameState.log.length;
    accumulatedCardDefIds = [];
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
  (ws as any).isAlive = true;
  ws.on("pong", () => {
    (ws as any).isAlive = true;
  });

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

    try {
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
              room.lastBroadcastLogLen = 0;
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
            // Find an open human slot (treat stale/closing sockets as empty)
            const openIdx = existing.players.findIndex((s) => {
              if (s.type !== "human") return false;
              if (!s.ws) return true;
              if (s.ws.readyState !== WebSocket.OPEN) {
                wsRoomMap.delete(s.ws);
                wsPlayerIndex.delete(s.ws);
                s.ws.terminate();
                s.ws = null;
                return true;
              }
              return false;
            });
            if (openIdx === -1) {
              sendToPlayer(ws, { type: "error", message: "Room is full" });
              return;
            }
            assignWsToRoom(ws, existing, openIdx);
            existing.players[openIdx].name = msg.playerName || "Commander";
            console.log(`Player 2 joined PvP room ${existing.id} (code ${code})`);
            sendToPlayer(ws, { type: "joined", roomId: existing.id });
            sendToPlayer(ws, { type: "cardRegistry", registry });
            if (existing.gameState) {
              existing.lastBroadcastLogLen = 0;
              broadcastGameState(existing);
            } else {
              // Send deckRequired to ALL human players who haven't submitted yet
              for (const slot of existing.players) {
                if (slot.type === "human" && slot.ws && !slot.deck) {
                  sendToPlayer(slot.ws, { type: "deckRequired" });
                }
              }
            }
            return;
          }

          // --- Reconnection by roomId ---
          if (msg.roomId) {
            const existing = roomsById.get(msg.roomId);
            if (existing) {
              // Find which slot this player was in.
              // Check for slots where ws is null OR the old ws is no longer open
              // (handles race where close event hasn't fired yet through proxy).
              let reconnectedIdx = -1;
              for (let i = 0; i < 2; i++) {
                if (existing.players[i].type !== "human") continue;
                const oldWs = existing.players[i].ws;
                if (!oldWs || oldWs.readyState !== WebSocket.OPEN) {
                  // Clean up the stale socket if present
                  if (oldWs) {
                    wsRoomMap.delete(oldWs);
                    wsPlayerIndex.delete(oldWs);
                    existing.players[i].ws = null;
                    oldWs.terminate();
                  }
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
                if (msg.playerName) {
                  existing.players[reconnectedIdx].name = msg.playerName;
                }
              } else {
                // Spectator reconnect
                assignWsToRoom(ws, existing, -1);
              }

              console.log(`Player reconnected to ${existing.id}`);
              sendToPlayer(ws, { type: "joined", roomId: existing.id });
              sendToPlayer(ws, { type: "cardRegistry", registry });
              if (existing.gameState) {
                existing.lastBroadcastLogLen = 0;
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
            room.players[0].name = msg.playerName || "Commander";
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

        case "resync": {
          const room = wsRoomMap.get(ws);
          if (!room?.gameState) break;
          console.log(`[WS] Resync requested in ${room.id}`);
          // Unstick any pending waitForContinue
          if (room.continueResolve) {
            console.warn(`[WS] Resync resolved stuck continueResolve in ${room.id}`);
            room.continueResolve();
          } else {
            // Just re-send current state
            room.lastBroadcastLogLen = 0;
            broadcastGameState(room);
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
          room.lastBroadcastLogLen = 0;
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

        case "debugSetup": {
          if (process.env.NODE_ENV === "production") {
            sendToPlayer(ws, { type: "error", message: "Debug mode disabled in production" });
            return;
          }

          // Capture player name before leaving old room
          let debugPlayerName = "Commander";
          if (wsRoomMap.has(ws)) {
            const oldRoom = wsRoomMap.get(ws)!;
            const oldIdx = wsPlayerIndex.get(ws);
            if (oldIdx !== undefined && oldIdx >= 0) {
              debugPlayerName = oldRoom.players[oldIdx].name || debugPlayerName;
              oldRoom.players[oldIdx].ws = null;
            } else {
              const specIdx = oldRoom.spectators.indexOf(ws);
              if (specIdx !== -1) oldRoom.spectators.splice(specIdx, 1);
            }
            wsRoomMap.delete(ws);
            wsPlayerIndex.delete(ws);
          }

          const debugRoom = createRoom("vs-ai");
          debugRoom.players[0].name = debugPlayerName;
          assignWsToRoom(ws, debugRoom, 0);

          sendToPlayer(ws, { type: "joined", roomId: debugRoom.id });
          sendToPlayer(ws, { type: "cardRegistry", registry });

          try {
            const debugNames: [string, string] = [
              debugRoom.players[0].name || "Player 1",
              debugRoom.players[1].name || "Player 2",
            ];
            debugRoom.gameState = createDebugGame(msg.scenario, registry, debugNames);
            // Set up AI deck slot so AI can respond
            debugRoom.players[1].deck = buildAIDeck(registry);
            debugRoom.players[0].deck = { baseId: msg.scenario.player0.baseId, deckCardIds: [] };

            console.log(`[DEBUG] Scenario loaded in ${debugRoom.id}`);
            broadcastGameState(debugRoom);

            // Process AI turns if it's AI's turn
            const gen = debugRoom.gameGeneration;
            processAITurns(debugRoom).catch((err) => {
              console.error(`AI processing error in ${debugRoom.id}:`, err);
              if (debugRoom.gameGeneration === gen) {
                debugRoom.aiProcessing = false;
                broadcastGameState(debugRoom);
              }
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendToPlayer(ws, { type: "error", message: `Debug setup failed: ${errMsg}` });
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
            // Capture challenge state before action for resolution detection
            const hadChallenge = !!room.gameState.challenge;
            const logLenBefore = room.gameState.log.length;
            const challengeCardDefIds: string[] = [];
            if (hadChallenge) {
              const ch = room.gameState.challenge!;
              challengeCardDefIds.push(
                ...defIdFromInstanceId(room.gameState, ch.challengerInstanceId),
              );
              if (ch.defenderInstanceId) {
                challengeCardDefIds.push(
                  ...defIdFromInstanceId(room.gameState, ch.defenderInstanceId),
                );
              }
            }

            const result = applyAction(room.gameState, pIdx, msg.action, bases);
            room.gameState = result.state;

            const challengeResolved = hadChallenge && !room.gameState.challenge;

            const aiErrorHandler = (err: unknown) => {
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
            };

            const gen = room.gameGeneration;

            if (challengeResolved && hasHumanViewer(room)) {
              // Show challenge resolution modal and wait for Continue
              const newEntries = room.gameState.log.slice(logLenBefore);
              const text = newEntries.map((e) => (typeof e === "string" ? e : e.msg)).join("\n");
              room.pendingNotification = {
                text,
                cardDefIds: challengeCardDefIds,
                logStart: logLenBefore,
                logEnd: room.gameState.log.length,
              };
              broadcastGameState(room);
              waitForContinue(room).then(() => {
                if (room.gameGeneration !== gen) return;
                room.pendingNotification = null;
                broadcastGameState(room);
                processAITurns(room).catch(aiErrorHandler);
              });
            } else {
              broadcastGameState(room);
              // Process AI turns after human acts — pass logLenBefore so the
              // popup includes log entries from the human action (e.g. committed cards)
              processAITurns(room, logLenBefore).catch(aiErrorHandler);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error(`Action error: ${errMsg}`);
            sendToPlayer(ws, { type: "error", message: errMsg });
          }
          break;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Unhandled error in message handler (type: ${msg.type}):`, errMsg);
      sendToPlayer(ws, { type: "error", message: `Server error: ${errMsg}` });
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    const reasonStr = reason.toString() || "none";
    const room = wsRoomMap.get(ws);
    const pIdx = wsPlayerIndex.get(ws);
    const phase = room?.gameState?.phase;
    const hasChallenge = !!room?.gameState?.challenge;
    const hasPendingContinue = !!room?.continueResolve;
    console.log(
      `[WS] Close code=${code} reason=${reasonStr}` +
        (room ? ` room=${room.id} player=${pIdx} phase=${phase}` : "") +
        (hasChallenge ? " challenge=active" : "") +
        (hasPendingContinue ? " pendingContinue=true" : ""),
    );
    if (room) {
      // Remove from player slot or spectator list
      if (pIdx !== undefined && pIdx >= 0) {
        room.players[pIdx].ws = null;
      } else {
        const specIdx = room.spectators.indexOf(ws);
        if (specIdx !== -1) room.spectators.splice(specIdx, 1);
      }

      wsRoomMap.delete(ws);
      wsPlayerIndex.delete(ws);

      // Check if any humans are still connected
      const anyConnected = room.players.some((s) => s.ws !== null) || room.spectators.length > 0;

      if (!anyConnected) {
        // Unstick AI loop if waiting for Continue with no one watching
        if (room.continueResolve) {
          room.continueResolve();
        }

        // Keep the room alive for reconnection; destroy after timeout
        const timer = setTimeout(() => {
          roomCleanupTimers.delete(room.id);
          destroyRoom(room);
          console.log(`Room ${room.id} cleaned up after timeout`);
        }, ROOM_CLEANUP_MS);
        roomCleanupTimers.set(room.id, timer);
      }
    }
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
