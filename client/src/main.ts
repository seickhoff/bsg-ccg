import type {
  ClientMessage,
  ServerMessage,
  GameAction,
  CardRegistry,
  DeckSubmission,
  LogItem,
} from "@bsg/shared";
import {
  renderWaiting,
  renderGame,
  setCardRegistry,
  setActionHandler,
  setContinueHandler,
  setResetGameHandler,
  setPlayerName,
} from "./renderer.js";
import { renderDeckBuilder } from "./deck-builder.js";
import { escapeHtml } from "./utils.js";
import "./style.css";

// ============================================================
// BSG CCG — Client Entry Point
// View state: splash → connecting → deckBuilder → playing
// ============================================================

// Prevent uncaught errors from crashing the page
window.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  event.preventDefault();
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  event.preventDefault();
});

const app = document.getElementById("app")!;

let ws: WebSocket | null = null;
// Expose for debug/testing from browser console
(window as any).__bsg_ws = () => ws;
(window as any).__bsg_send = (msg: any) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
let currentRegistry: CardRegistry | null = null;
let currentRoomId: string | null = sessionStorage.getItem("bsg-roomId");
let intentionalDisconnect = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let fullLog: LogItem[] = [];
let pendingJoin: ClientMessage | null = null;

function sendMessage(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendAction(action: GameAction): void {
  sendMessage({ type: "action", action });
}

function newGame(): void {
  // Remove modals attached to document.body
  document
    .querySelectorAll(".action-modal-overlay, .player-action-overlay, .log-modal-overlay")
    .forEach((el) => el.remove());
  // Clear old room and start fresh
  fullLog = [];
  sessionStorage.removeItem("bsg-roomId");
  currentRoomId = null;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Close WebSocket intentionally — don't auto-reconnect
  if (ws) {
    intentionalDisconnect = true;
    ws.close();
    ws = null;
  }
  // Return to splash
  renderSplash();
}

setActionHandler(sendAction);
setContinueHandler(() => sendMessage({ type: "continue" }));
setResetGameHandler(newGame);

function handleDeckSubmit(submission: DeckSubmission): void {
  sendMessage({
    type: "submitDeck",
    baseId: submission.baseId,
    deckCardIds: submission.deckCardIds,
  });

  app.innerHTML = `
    <div class="waiting">
      <h1>BSG CCG</h1>
      <p>Starting game...</p>
    </div>
  `;
}

// --- Splash Screen ---

function renderSplash(): void {
  const savedName = localStorage.getItem("bsg-player-name") || "";

  app.innerHTML = `
    <div class="splash">
      <img src="images/cards/bsgbetback-portrait.jpg" alt="BSG" class="splash-card" />
      <h1 class="splash-title">BSG CCG</h1>
      <div class="splash-form">
        <input
          type="text"
          id="splash-name"
          class="splash-input"
          placeholder="Enter your callsign"
          value="${escapeHtml(savedName)}"
          maxlength="20"
          autocomplete="off"
        />
        <button id="splash-join" class="splash-btn">Play vs AI</button>
        <button id="splash-pvp" class="splash-btn splash-btn-secondary">Play vs Player</button>
        <button id="splash-join-code" class="splash-btn splash-btn-secondary">Join Game</button>
      </div>
      <div id="join-code-form" class="splash-form" style="display:none; margin-top: 0.5rem;">
        <input
          type="text"
          id="splash-code-input"
          class="splash-input"
          placeholder="Enter join code"
          maxlength="6"
          autocomplete="off"
          style="text-transform: uppercase; letter-spacing: 0.2em; font-weight: 700;"
        />
        <button id="splash-code-submit" class="splash-btn">Join</button>
      </div>
    </div>
  `;

  const nameInput = document.getElementById("splash-name") as HTMLInputElement;
  const joinBtn = document.getElementById("splash-join") as HTMLButtonElement;
  const pvpBtn = document.getElementById("splash-pvp") as HTMLButtonElement;
  const joinCodeBtn = document.getElementById("splash-join-code") as HTMLButtonElement;
  const joinCodeForm = document.getElementById("join-code-form") as HTMLDivElement;
  const codeInput = document.getElementById("splash-code-input") as HTMLInputElement;
  const codeSubmitBtn = document.getElementById("splash-code-submit") as HTMLButtonElement;

  function saveName(): string {
    const name = nameInput.value.trim() || "Commander";
    localStorage.setItem("bsg-player-name", name);
    setPlayerName(name);
    return name;
  }

  function showConnecting(): void {
    app.innerHTML = `
      <div class="waiting">
        <h1>BSG CCG</h1>
        <div class="spinner"></div>
        <p>Connecting to server...</p>
      </div>
    `;
  }

  // Play vs AI
  joinBtn.addEventListener("click", () => {
    const name = saveName();
    pendingJoin = { type: "joinGame", mode: "vs-ai", playerName: name };
    showConnecting();
    connect();
  });

  // Host PvP game
  pvpBtn.addEventListener("click", () => {
    const name = saveName();
    pendingJoin = { type: "joinGame", mode: "vs-player", playerName: name };
    showConnecting();
    connect();
  });

  // Toggle join code input
  joinCodeBtn.addEventListener("click", () => {
    const visible = joinCodeForm.style.display !== "none";
    joinCodeForm.style.display = visible ? "none" : "flex";
    if (!visible) codeInput.focus();
  });

  // Submit join code
  function submitCode(): void {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return;
    const name = saveName();
    pendingJoin = { type: "joinGame", joinCode: code, playerName: name };
    showConnecting();
    connect();
  }
  codeSubmitBtn.addEventListener("click", submitCode);
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCode();
  });

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      joinBtn.click();
    }
  });

  nameInput.focus();
  if (nameInput.value) nameInput.select();
}

// --- WebSocket Connection ---

function connect(): void {
  const wsUrl = import.meta.env.VITE_WS_URL;
  let url: string;
  if (wsUrl) {
    url = wsUrl;
  } else {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url = `${protocol}//${location.host}/ws`;
  }
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("Connected to server");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pendingJoin) {
      // User explicitly chose a mode/code — always use it
      sendMessage(pendingJoin);
      pendingJoin = null;
    } else if (currentRoomId) {
      // Reconnecting to existing room (tab refresh / background reconnect)
      sendMessage({ type: "joinGame", roomId: currentRoomId });
    } else {
      // Fallback: vs-ai
      sendMessage({ type: "joinGame", mode: "vs-ai" });
    }
  });

  ws.addEventListener("close", (event) => {
    console.log(
      `Disconnected (code: ${event.code}, reason: ${event.reason || "none"}, clean: ${event.wasClean})`,
    );
    if (intentionalDisconnect) {
      intentionalDisconnect = false;
      reconnectAttempts = 0;
      return;
    }
    // Fast retries first (500ms), then back off, cap at 5s
    const delay = Math.min(500 * Math.pow(1.5, reconnectAttempts), 5000);
    reconnectAttempts++;

    // Silent reconnect — game UI stays untouched
    reconnectTimer = setTimeout(connect, delay);
  });

  ws.addEventListener("error", (event) => {
    console.error("WebSocket error:", event);
  });

  ws.addEventListener("message", (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.error("Invalid message from server:", event.data);
      return;
    }

    switch (msg.type) {
      case "joined":
        currentRoomId = msg.roomId;
        sessionStorage.setItem("bsg-roomId", msg.roomId);
        fullLog = [];
        break;

      case "cardRegistry":
        currentRegistry = msg.registry;
        setCardRegistry(msg.registry);
        break;

      case "deckRequired":
        fullLog = [];
        document
          .querySelectorAll(".action-modal-overlay, .player-action-overlay, .log-modal-overlay")
          .forEach((el) => el.remove());
        if (currentRegistry) {
          renderDeckBuilder(app, currentRegistry, handleDeckSubmit);
        }
        break;

      case "gameSetup":
        if (msg.joinCode) {
          app.innerHTML = `
            <div class="waiting">
              <h1>BSG CCG</h1>
              <p>Share this code with your opponent:</p>
              <div class="join-code-display">${escapeHtml(msg.joinCode)}</div>
              <div class="spinner"></div>
              <p>Waiting for opponent to join...</p>
            </div>
          `;
        }
        break;

      case "waitingForOpponent":
        renderWaiting(app);
        break;

      case "gameState":
        try {
          fullLog.push(...msg.log);
          renderGame(app, msg.state, msg.validActions, fullLog, msg.aiActing, msg.notification);
        } catch (err) {
          console.error("Render error:", err);
        }
        break;

      case "error":
        console.error("Server error:", msg.message);
        // Show error on screen if we're on a waiting/connecting screen
        if (app.querySelector(".waiting")) {
          const p = app.querySelector(".waiting p:last-child");
          if (p) p.textContent = msg.message;
          const spinner = app.querySelector(".spinner");
          if (spinner) spinner.remove();
        }
        break;
    }
  });
}

// --- Reconnect when tab regains focus (background tabs kill sockets) ---
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ws && ws.readyState !== WebSocket.OPEN) {
    console.log("Tab visible again — socket not open, reconnecting");
    ws.close();
    connect();
  }
});

// --- Initial render ---

// If we have a stored room, skip splash and auto-rejoin
if (currentRoomId) {
  const savedName = localStorage.getItem("bsg-player-name") || "Commander";
  setPlayerName(savedName);
  app.innerHTML = `
    <div class="waiting">
      <h1>BSG CCG</h1>
      <div class="spinner"></div>
      <p>Reconnecting...</p>
    </div>
  `;
  connect();
} else {
  renderSplash();
}
