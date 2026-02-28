import type {
  ClientMessage,
  ServerMessage,
  GameAction,
  CardRegistry,
  DeckSubmission,
} from "@bsg/shared";
import {
  renderWaiting,
  renderGame,
  setCardRegistry,
  setActionHandler,
  setContinueHandler,
} from "./renderer.js";
import { renderDeckBuilder } from "./deck-builder.js";
import "./style.css";

// ============================================================
// BSG CCG — Client Entry Point
// View state: connecting → deckBuilder → playing
// ============================================================

const app = document.getElementById("app")!;

let ws: WebSocket | null = null;
let currentRegistry: CardRegistry | null = null;

function sendMessage(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendAction(action: GameAction): void {
  sendMessage({ type: "action", action });
}

setActionHandler(sendAction);
setContinueHandler(() => sendMessage({ type: "continue" }));

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

// --- WebSocket Connection ---

function connect(): void {
  const wsUrl = import.meta.env.VITE_WS_URL;
  let url: string;
  if (wsUrl) {
    // Production: connect to configured server URL
    url = wsUrl;
  } else {
    // Dev: use Vite proxy on same host
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url = `${protocol}//${location.host}/ws`;
  }
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("Connected to server");
    sendMessage({ type: "joinGame" });
  });

  ws.addEventListener("close", () => {
    console.log("Disconnected");
    app.innerHTML = `
      <div class="waiting">
        <h1>BSG CCG</h1>
        <p>Disconnected — reconnecting...</p>
      </div>
    `;
    setTimeout(connect, 2000);
  });

  ws.addEventListener("message", (event) => {
    const msg: ServerMessage = JSON.parse(event.data);

    switch (msg.type) {
      case "cardRegistry":
        currentRegistry = msg.registry;
        setCardRegistry(msg.registry);
        break;

      case "deckRequired":
        if (currentRegistry) {
          renderDeckBuilder(app, currentRegistry, handleDeckSubmit);
        }
        break;

      case "waitingForOpponent":
        renderWaiting(app);
        break;

      case "gameState":
        renderGame(app, msg.state, msg.validActions, msg.log, msg.aiActing, msg.notification);
        break;

      case "error":
        console.error("Server error:", msg.message);
        break;
    }
  });
}

// --- Initial render ---
app.innerHTML = `
  <div class="waiting">
    <h1>BSG CCG</h1>
    <p>Connecting to server...</p>
  </div>
`;

connect();
