import type {
  PlayerGameView,
  ValidAction,
  GameAction,
  CardInstance,
  ResourceStack,
  UnitStack,
  CardDef,
  BaseCardDef,
  CardRegistry,
  OpponentView,
  CylonThreatCard,
  ActionNotification,
} from "@bsg/shared";
import { setPreviewRegistry, showCardPreview, showCardPreviewNav } from "./card-preview.js";

// ============================================================
// BSG CCG — Client Renderer
// Renders the 3-zone game board to the DOM.
// ============================================================

let cardDefs: Record<string, CardDef> = {};
let baseDefs: Record<string, BaseCardDef> = {};
let onAction: ((action: GameAction) => void) | null = null;
let onContinue: (() => void) | null = null;
let onResetGame: (() => void) | null = null;
let playerName = "YOU";
let currentLog: string[] = [];
let currentPlayerIndex = 0;
let selectMode: {
  type: string;
  callback: (id: string | number) => void;
  selectableIds?: string[];
  selectableIndices?: number[];
} | null = null;

export function setCardRegistry(registry: CardRegistry): void {
  cardDefs = registry.cards;
  baseDefs = registry.bases;
  setPreviewRegistry(registry);
}

export function setActionHandler(handler: (action: GameAction) => void): void {
  onAction = handler;
}

export function setContinueHandler(handler: () => void): void {
  onContinue = handler;
}

export function setResetGameHandler(handler: () => void): void {
  onResetGame = handler;
}

export function setPlayerName(name: string): void {
  playerName = name || "YOU";
}

function getCardDef(defId: string): CardDef | BaseCardDef | null {
  return cardDefs[defId] ?? baseDefs[defId] ?? null;
}

function getCardName(defId: string): string {
  const def = getCardDef(defId);
  if (!def) return defId;
  if (def.title && "subtitle" in def && def.subtitle) return `${def.title}, ${def.subtitle}`;
  if ("subtitle" in def && def.subtitle) return def.subtitle;
  return def.title ?? defId;
}

function getCardTypeClass(defId: string): string {
  const def = cardDefs[defId];
  if (!def) return "base";
  return def.type;
}

function getCardPower(defId: string): number {
  const def = getCardDef(defId);
  if (!def) return 0;
  return def.power ?? 0;
}

function getCardCylonThreat(defId: string): number {
  const def = cardDefs[defId];
  if (!def) return 0;
  return def.cylonThreat ?? 0;
}

function getCardMysticValue(defId: string): number {
  const def = cardDefs[defId];
  if (!def) return 0;
  return def.mysticValue ?? 0;
}

function getResourceIcon(defId: string): string {
  const base = baseDefs[defId];
  if (base) return resourceIcon(base.resource);
  const card = cardDefs[defId];
  if (card?.resource) return resourceIcon(card.resource);
  return "";
}

function formatCost(cost: CardDef["cost"]): string {
  if (!cost) return "Free";
  return Object.entries(cost)
    .map(([res, amt]) => `${amt}${resourceIcon(res)}`)
    .join(" ");
}

function resourceIcon(type: string): string {
  switch (type) {
    case "persuasion":
      return "P";
    case "logistics":
      return "L";
    case "security":
      return "S";
    default:
      return "?";
  }
}

function costBadgeHtml(cost: CardDef["cost"]): string {
  if (!cost) return "";
  return Object.entries(cost)
    .map(([res, amt]) => {
      const letter = resourceIcon(res);
      return `<span class="resource-inline-badge resource-inline-badge--${res}">${amt}${letter}</span>`;
    })
    .join(" ");
}

function resourceBadgeHtml(defId: string): string {
  const card = cardDefs[defId];
  if (!card) return "";
  const res = card.resource;
  if (!res)
    return `<span class="resource-inline-badge resource-inline-badge--supply">supply</span>`;
  const letter = resourceIcon(res);
  return `<span class="resource-inline-badge resource-inline-badge--${res}">${letter}</span>`;
}

// ============================================================
// Main Render
// ============================================================

export function renderWaiting(container: HTMLElement): void {
  container.innerHTML = `
    <div class="waiting">
      <h1>BSG CCG</h1>
      <p>Waiting for opponent to connect...</p>
      <div class="spinner"></div>
    </div>
  `;
}

function formatLogForDisplay(entry: string, yourPlayerIndex: number): string {
  const youLabel = `Player ${yourPlayerIndex + 1}`;
  const oppLabel = `Player ${1 - yourPlayerIndex + 1}`;
  return entry
    .replace(new RegExp(youLabel, "g"), playerName)
    .replace(new RegExp(oppLabel, "g"), "Opponent");
}

const NOISE_LINES = new Set([
  "Turn ends.",
  "Cylon phase ends.",
  "Execution phase ends.",
  "Execution phase begins.",
  "Ready phase: reorder unit stacks.",
  "All players passed. Execution phase ends.",
  "Execution phase ends (False Peace).",
  "Extra execution phase begins (False Peace).",
]);

function formatNotificationHtml(text: string, playerIndex: number): string {
  const lines = text.split("\n").map((line) => {
    // Strip timestamp prefix [HH:MM:SS]
    const stripped = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    return formatLogForDisplay(stripped, playerIndex);
  });

  type Section = { label: string; items: string[] };
  const sections: (string | Section)[] = []; // string = turn header, Section = grouped items
  let current: Section | null = null;

  function ensureSection(label: string): Section {
    if (current && current.label === label) return current;
    current = { label, items: [] };
    sections.push(current);
    return current;
  }

  for (const line of lines) {
    if (!line.trim()) continue;

    // Turn header
    const turnMatch = line.match(/^--- Turn (\d+) ---$/);
    if (turnMatch) {
      sections.push(`Turn ${turnMatch[1]}`);
      current = null;
      continue;
    }

    // Filter noise
    if (NOISE_LINES.has(line)) continue;
    // Also filter "Both players ready. Starting Turn X." since we already show turn header
    if (/^Both players ready\b/.test(line)) continue;

    // Categorize and clean up
    if (/readies:/.test(line)) {
      ensureSection("Ready").items.push(line);
    } else if (
      /Cylon phase:|Cylon attack|No Cylon attack|Cylon Betrayal|threat level|fleet defense|sacrifices a supply|has no asset|threat.*removed|fleet must jump/i.test(
        line,
      )
    ) {
      // Clean up redundant "Cylon phase: " prefix and reformat
      let cleaned = line.replace(/^Cylon phase:\s*/, "");
      cleaned = cleaned.replace(
        /threat level is (\d+), fleet defense is (\d+)\./,
        "Threat $1 | Fleet defense $2",
      );
      cleaned = cleaned.replace(/^No Cylon attack this turn\.$/, "No Cylon attack");
      ensureSection("Cylon Phase").items.push(cleaned);
    } else if (/All players draw/.test(line)) {
      ensureSection("Ready").items.push(line);
    } else {
      ensureSection("Execution").items.push(line);
    }
  }

  // Render HTML
  const parts: string[] = [];
  for (const s of sections) {
    if (typeof s === "string") {
      parts.push(`<div class="notif-turn-header">${escapeHtml(s)}</div>`);
    } else {
      if (s.items.length === 0) continue;
      parts.push(`<div class="notif-section">`);
      parts.push(`<div class="notif-section-label">${escapeHtml(s.label)}</div>`);
      parts.push(`<div class="notif-items">`);
      for (const item of s.items) {
        parts.push(`<div class="notif-item">${escapeHtml(item)}</div>`);
      }
      parts.push(`</div></div>`);
    }
  }
  return parts.join("");
}

export function renderGame(
  container: HTMLElement,
  state: PlayerGameView,
  validActions: ValidAction[],
  log: string[],
  aiActing?: boolean,
  notification?: ActionNotification,
): void {
  selectMode = null;
  const isYourTurn = state.activePlayerIndex === state.you.playerIndex;
  currentLog = log;
  currentPlayerIndex = state.you.playerIndex;

  // Preserve play-area scroll position across re-renders
  const prevBoards = container.querySelector(".boards");
  const prevScrollTop = prevBoards ? prevBoards.scrollTop : 0;

  container.innerHTML = `
    <div class="game-board">
      <div class="info-bar">
        <div class="info-bar-left">
          <span class="info-item">T${state.turn}</span>
          <span class="info-item phase">${formatPhase(state.phase, state.readyStep)}</span>
          <span class="info-item ${isYourTurn ? "your-turn" : "opp-turn"}">${isYourTurn ? "YOU" : "OPP"}</span>
          <span class="info-item">Fleet: ${state.fleetDefenseLevel}</span>
          <span class="info-item threat-level">Threat: ${computeThreatLevel(state)}</span>
        </div>
        <div class="info-bar-right">
          <button class="header-btn" id="actions-fab" style="display:none">Actions</button>
          <button class="header-btn" id="log-btn">Log</button>
          <button class="header-btn" id="new-game-btn">New Game</button>
        </div>
      </div>

      <div class="influence-bar">
        <div class="influence you">${escapeHtml(playerName)}: ${state.you.influence} influence</div>
        <div class="influence opp">Opponent: ${state.opponent.influence} influence</div>
      </div>

      ${state.winner !== null ? renderWinner(state) : ""}

      <div class="boards">
        <div class="opponent-board">
          <div class="board-label">OPPONENT</div>
          ${renderOpponentZones(state.opponent)}
        </div>

        <div class="divider"></div>

        <div class="your-board">
          <div class="board-label">${escapeHtml(playerName.toUpperCase())} (Player ${state.you.playerIndex + 1})</div>
          ${renderYourZones(state, validActions)}
        </div>
      </div>

      ${state.cylonThreats.length > 0 ? renderCylonThreats(state.cylonThreats) : ""}

      <div class="hand-area">
        <div class="hand-label">HAND (${state.you.hand.length} cards) | Deck: ${state.you.deckCount} | <span class="discard-link" id="your-discard-btn">Discard: ${state.you.discardCount}</span></div>
        <div class="hand-label opp-info">Opponent — Hand: ${state.opponent.handCount} | Deck: ${state.opponent.deckCount} | <span class="discard-link" id="opp-discard-btn">Discard: ${state.opponent.discardCount}</span></div>
        <div class="hand-cards-wrapper">
          <div class="hand-scroll-hint hand-scroll-hint--left" id="hand-scroll-left">&#x2039;</div>
          <div class="hand-cards" id="hand-cards">
            ${state.you.hand.map((card, i) => renderHandCard(card, i, validActions)).join("")}
          </div>
          <div class="hand-scroll-hint hand-scroll-hint--right" id="hand-scroll-right">&#x203A;</div>
        </div>
      </div>

      <div class="actions-bar" id="actions-bar">
        ${renderActions(validActions, state, aiActing)}
      </div>

    </div>
  `;

  // Restore play-area scroll position
  const newBoards = container.querySelector(".boards");
  if (newBoards) newBoards.scrollTop = prevScrollTop;

  // Attach event listeners
  attachEventListeners(container, validActions, state);

  // Dismiss stale overlays before showing new ones
  document.querySelector(".action-modal-overlay")?.remove();
  document.querySelector(".player-action-overlay")?.remove();

  // Show action notification modal for AI actions
  if (notification) {
    showActionModal(notification, log, state.you.playerIndex);
  } else if (validActions.length > 0) {
    // Show player action modal when it's the player's turn
    showPlayerActionModal(validActions, state, container);
  }
}

function showActionModal(
  notification: ActionNotification,
  _log: string[],
  playerIndex: number,
): void {
  // Remove any existing modals (both notification and player-action)
  document.querySelector(".action-modal-overlay")?.remove();
  document.querySelector(".player-action-overlay")?.remove();

  // Build thumbnail HTML from card def IDs
  const thumbsHtml = notification.cardDefIds
    .map((defId: string) => {
      const card = cardDefs[defId];
      const base = baseDefs[defId];
      const image = card?.image ?? base?.image;
      if (!image) return "";
      const isBase = !!base;
      return `<img src="${image}" alt="" class="action-modal-thumb ${isBase ? "card-clip-landscape" : ""}" data-def-id="${defId}" />`;
    })
    .filter(Boolean)
    .join("");

  // Format notification as structured summary
  const summaryHtml = formatNotificationHtml(notification.text, playerIndex);

  const overlay = document.createElement("div");
  overlay.className = "action-modal-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-top">
        <div class="action-modal-text">${summaryHtml}</div>
        ${thumbsHtml ? `<div class="action-modal-thumbs">${thumbsHtml}</div>` : ""}
        <button class="action-modal-continue">Continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Wire thumbnail clicks → card preview
  overlay.querySelectorAll(".action-modal-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (thumb as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Wire Continue button
  overlay.querySelector(".action-modal-continue")?.addEventListener("click", () => {
    overlay.remove();
    if (onContinue) onContinue();
  });
}

function formatLogEntry(raw: string, playerIndex: number): string {
  const tsMatch = raw.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
  const ts = tsMatch ? tsMatch[1] : "";
  const text = tsMatch ? raw.slice(tsMatch[0].length) : raw;
  const formatted = escapeHtml(formatLogForDisplay(text, playerIndex));
  return `<div class="log-entry"><span class="log-ts">${ts}</span>${formatted}</div>`;
}

function showLogModal(): void {
  // Remove any existing log modal
  document.querySelector(".log-modal-overlay")?.remove();

  // Most recent entries first
  const logHtml = [...currentLog]
    .reverse()
    .map((l) => formatLogEntry(l, currentPlayerIndex))
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "log-modal-overlay";
  overlay.innerHTML = `
    <div class="log-modal">
      <div class="log-modal-header">
        <span class="log-modal-title">Action Log</span>
        <button class="log-modal-close">&times;</button>
      </div>
      <div class="log-modal-body">${logHtml}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close button
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    overlay.remove();
  });
}

function showConfirmResetModal(): void {
  document.querySelector(".log-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "log-modal-overlay";
  overlay.innerHTML = `
    <div class="log-modal">
      <div class="log-modal-header">
        <span class="log-modal-title">New Game?</span>
        <button class="log-modal-close">&times;</button>
      </div>
      <div class="log-modal-body" style="text-align:center; padding:1rem;">
        <p>Abandon the current game and start over?</p>
        <div style="display:flex; gap:0.75rem; justify-content:center; margin-top:1rem;">
          <button class="action-btn" id="confirm-reset-yes">Yes, new game</button>
          <button class="action-btn" id="confirm-reset-no">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.querySelector("#confirm-reset-no")?.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.querySelector("#confirm-reset-yes")?.addEventListener("click", () => {
    overlay.remove();
    onResetGame?.();
  });
}

function showDiscardBrowser(cards: CardInstance[], title: string): void {
  document.querySelector(".log-modal-overlay")?.remove();

  const cardsHtml =
    cards.length === 0
      ? '<div class="log-entry">No cards in discard pile.</div>'
      : cards
          .map((c) => {
            const def = cardDefs[c.defId];
            const name = def ? getCardName(c.defId) : c.defId;
            const type = def?.type ?? "";
            const image = def?.image;
            return `<div class="discard-card-entry" data-def-id="${c.defId}">
          ${image ? `<img src="${image}" alt="${name}" class="discard-thumb" />` : ""}
          <span class="discard-card-name">${escapeHtml(name)}</span>
          <span class="discard-card-type">${type}</span>
        </div>`;
          })
          .join("");

  const overlay = document.createElement("div");
  overlay.className = "log-modal-overlay";
  overlay.innerHTML = `
    <div class="log-modal">
      <div class="log-modal-header">
        <span class="log-modal-title">${escapeHtml(title)}</span>
        <button class="log-modal-close">&times;</button>
      </div>
      <div class="log-modal-body discard-browser">${cardsHtml}</div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    overlay.remove();
  });
  // Click on card entry to show preview
  overlay.querySelectorAll(".discard-card-entry").forEach((el) => {
    el.addEventListener("click", () => {
      const defId = (el as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });
}

function dismissPlayerActionModal(): void {
  document.querySelector(".player-action-overlay")?.remove();
}

/** Build a small thumbnail <img> for an action's card, or empty string if none. */
function getActionThumbHtml(action: ValidAction): string {
  if (!action.cardDefId) return "";
  const card = cardDefs[action.cardDefId];
  const base = baseDefs[action.cardDefId];
  const image = card?.image ?? base?.image;
  if (!image) return "";
  const isBase = !!base;
  return `<img src="${image}" alt="" class="action-row-thumb${isBase ? " card-clip-landscape" : ""}" data-def-id="${action.cardDefId}" />`;
}

function showPlayerActionModal(
  validActions: ValidAction[],
  state: PlayerGameView,
  container: HTMLElement,
): void {
  // Remove any existing player action modal
  dismissPlayerActionModal();

  // Contextual header based on game state
  let headerText = `${playerName} — Choose an action`;
  if (state.challenge) {
    const isChallenger = state.challenge.challengerPlayerIndex === state.you.playerIndex;
    if (
      state.challenge.waitingForDefender &&
      state.challenge.defenderSelector === "challenger" &&
      isChallenger
    ) {
      headerText = `${playerName} — Sniper: Choose opponent's defender`;
    } else if (state.challenge.waitingForDefender && !isChallenger) {
      headerText = `${playerName} — Choose a defender or decline`;
    } else if (state.challenge.step === 2) {
      headerText = `${playerName} — Play effects or pass`;
    } else {
      headerText = "Challenge in progress";
    }
  } else if (state.phase === "ready" && state.readyStep === 4) {
    headerText = `${playerName} — Deploy a card to resource area`;
  } else if (state.phase === "ready" && state.readyStep === 5) {
    headerText = `${playerName} — Reorder unit stacks`;
  } else if (state.phase === "cylon") {
    headerText = `${playerName} — Cylon phase`;
  } else if (state.phase === "execution") {
    headerText = `${playerName} — Execution phase`;
  }

  // During execution phase, hide disabled actions and group by card type
  const isExecution = state.phase === "execution" && !state.challenge;
  const displayActions = isExecution ? validActions.filter((a) => !a.disabled) : validActions;

  function actionGroupKey(a: ValidAction): string {
    if (a.type === "pass" || a.type === "challengePass") return "zzz_pass"; // sort last
    if (a.type === "challenge") return "zz_challenge";
    if (a.type === "sacrificeFromStack") return "zy_sacrifice";
    if (!a.cardDefId) return "zx_other";
    if (baseDefs[a.cardDefId]) return "aa_base";
    const def = cardDefs[a.cardDefId];
    if (!def) return "zx_other";
    return def.type; // "personnel" | "ship" | "event" | "mission"
  }

  const groupLabels: Record<string, string> = {
    personnel: "Personnel",
    ship: "Ships",
    event: "Events",
    mission: "Missions",
    aa_base: "Base Ability",
    zy_sacrifice: "Sacrifice",
    zz_challenge: "Challenge",
    zzz_pass: "",
    zx_other: "",
  };

  let buttonsHtml: string;
  if (isExecution && displayActions.length > 0) {
    // Group actions by card type, preserving original indices for data-action-index
    const groups = new Map<string, { action: ValidAction; origIdx: number }[]>();
    for (let i = 0; i < validActions.length; i++) {
      const a = validActions[i];
      if (a.disabled) continue;
      const key = actionGroupKey(a);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ action: a, origIdx: i });
    }
    const sortedKeys = [...groups.keys()].sort();
    const parts: string[] = [];
    for (const key of sortedKeys) {
      const label = groupLabels[key] ?? key;
      if (label) parts.push(`<div class="action-group-label">${escapeHtml(label)}</div>`);
      for (const { action: a, origIdx } of groups.get(key)!) {
        const thumbHtml = getActionThumbHtml(a);
        const def = a.cardDefId ? cardDefs[a.cardDefId] : null;
        const badge = def ? costBadgeHtml(def.cost) : "";
        const labelHtml = escapeHtml(a.description) + (badge ? ` ${badge}` : "");
        if (thumbHtml) {
          parts.push(
            `<div class="action-row"><button class="action-modal-btn action-modal-btn--with-thumb" data-action-index="${origIdx}">${labelHtml}</button>${thumbHtml}</div>`,
          );
        } else {
          parts.push(
            `<button class="action-modal-btn" data-action-index="${origIdx}">${labelHtml}</button>`,
          );
        }
      }
    }
    buttonsHtml = parts.join("");
  } else {
    buttonsHtml = displayActions
      .map((a, _di) => {
        // Find original index in validActions for data-action-index
        const i = validActions.indexOf(a);
        const disabledClass = a.disabled ? " action-modal-btn--disabled" : "";
        const thumbHtml = getActionThumbHtml(a);
        // Add resource badge for deploy-to-resource actions
        const badge =
          a.type === "playToResource" && a.cardDefId ? resourceBadgeHtml(a.cardDefId) : "";
        const labelHtml = escapeHtml(a.description) + (badge ? ` ${badge}` : "");
        if (thumbHtml) {
          return `<div class="action-row${a.disabled ? " action-row--disabled" : ""}"><button class="action-modal-btn action-modal-btn--with-thumb${disabledClass}" data-action-index="${i}">${labelHtml}</button>${thumbHtml}</div>`;
        }
        return `<button class="action-modal-btn${disabledClass}" data-action-index="${i}">${labelHtml}</button>`;
      })
      .join("");
  }

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-top">
        <div class="action-modal-header-row">
          <div class="action-modal-text">${escapeHtml(headerText)}</div>
          <button class="action-modal-toggle" title="Hide to review cards">&#x25BC;</button>
        </div>
        <div class="player-action-buttons">${buttonsHtml}</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".action-modal") as HTMLElement;
  const toggle = overlay.querySelector(".action-modal-toggle") as HTMLElement;
  const headerFab = document.getElementById("actions-fab");

  // Collapse: hide panel, show header button
  toggle.addEventListener("click", () => {
    modal.style.display = "none";
    if (headerFab) headerFab.style.display = "";
  });

  // Expand from header button
  if (headerFab) {
    headerFab.addEventListener("click", () => {
      modal.style.display = "";
      headerFab.style.display = "none";
    });
  }

  // Wire action buttons
  overlay.querySelectorAll(".action-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt((btn as HTMLElement).dataset.actionIndex ?? "-1");
      const action = validActions[idx];
      if (!action || action.disabled) return;

      // Dismiss modal before handling (select modes need the board visible)
      dismissPlayerActionModal();
      handleActionClick(action, validActions, state, container);
    });
  });

  // Wire thumbnail clicks → card preview (separate from action trigger)
  overlay.querySelectorAll(".action-row-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (thumb as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });
}

/** Generic prompt modal for sub-actions (resource deploy, select mode, etc.).
 *  Reuses the same overlay pattern as showPlayerActionModal. */
function showPromptModal(
  prompt: string,
  buttons: {
    label: string;
    onClick: () => void;
    cancel?: boolean;
    cardDefId?: string;
    badge?: { resName: string; total: number; letter: string };
  }[],
): void {
  dismissPlayerActionModal();

  const buttonsHtml = buttons
    .map((b, i) => {
      const btnClass = `action-modal-btn${b.cancel ? " cancel-modal-btn" : ""}${b.cardDefId ? " action-modal-btn--with-thumb" : ""}`;
      const badgeHtml = b.badge
        ? ` <span class="resource-inline-badge resource-inline-badge--${b.badge.resName}">${b.badge.total}${b.badge.letter}</span>`
        : "";
      const btnHtml = `<button class="${btnClass}" data-btn-index="${i}">${escapeHtml(b.label)}${badgeHtml}</button>`;
      if (b.cardDefId) {
        const card = cardDefs[b.cardDefId];
        const base = baseDefs[b.cardDefId];
        const image = card?.image ?? base?.image;
        if (image) {
          const isBase = !!base;
          const thumbHtml = `<img src="${image}" alt="" class="action-row-thumb${isBase ? " card-clip-landscape" : ""}" data-def-id="${b.cardDefId}" />`;
          return `<div class="action-row">${btnHtml}${thumbHtml}</div>`;
        }
      }
      return btnHtml;
    })
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-top">
        <div class="action-modal-header-row">
          <div class="action-modal-text">${escapeHtml(prompt)}</div>
          <button class="action-modal-toggle" title="Hide to review cards">&#x25BC;</button>
        </div>
        <div class="player-action-buttons">${buttonsHtml}</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".action-modal") as HTMLElement;
  const toggle = overlay.querySelector(".action-modal-toggle") as HTMLElement;
  const headerFab = document.getElementById("actions-fab");

  toggle.addEventListener("click", () => {
    modal.style.display = "none";
    if (headerFab) {
      headerFab.style.display = "";
      headerFab.onclick = () => {
        modal.style.display = "";
        headerFab.style.display = "none";
      };
    }
  });

  overlay.querySelectorAll("[data-btn-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt((btn as HTMLElement).dataset.btnIndex ?? "-1");
      if (buttons[idx]) buttons[idx].onClick();
    });
  });

  // Wire thumbnail clicks → card preview
  overlay.querySelectorAll(".action-row-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (thumb as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });
}

// ============================================================
// Sub-renderers
// ============================================================

function renderWinner(state: PlayerGameView): string {
  const isWinner = state.winner === state.you.playerIndex;
  return `<div class="winner-banner ${isWinner ? "win" : "lose"}">${isWinner ? "YOU WIN!" : "YOU LOSE"}</div>`;
}

function formatPhase(phase: string, readyStep: number): string {
  switch (phase) {
    case "setup":
      return "Setup";
    case "ready":
      switch (readyStep) {
        case 3:
          return "Ready \u2014 Draw Cards";
        case 4:
          return "Ready \u2014 Deploy Resource";
        case 5:
          return "Ready \u2014 Reorder Stacks";
        default:
          return `Ready (step ${readyStep})`;
      }
    case "execution":
      return "Execution";
    case "cylon":
      return "Cylon";
    case "gameOver":
      return "Game Over";
    default:
      return phase;
  }
}

function renderOpponentZones(opp: OpponentView): string {
  return `
    <div class="zone resource-zone">
      <div class="zone-label">Resource</div>
      <div class="zone-cards">
        ${opp.zones.resourceStacks.map((stack) => renderResourceStack(stack, false)).join("")}
        ${(opp.zones.persistentMissions ?? []).map((mc) => renderPersistentMission(mc)).join("")}
      </div>
    </div>
    <div class="zone reserve-zone">
      <div class="zone-label">Reserve</div>
      <div class="zone-cards">
        ${opp.zones.reserve.map((stack) => renderUnitStack(stack, false)).join("")}
        ${opp.zones.reserve.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone alert-zone">
      <div class="zone-label">Alert</div>
      <div class="zone-cards">
        ${opp.zones.alert.map((stack) => renderUnitStack(stack, false)).join("")}
        ${opp.zones.alert.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
  `;
}

function renderYourZones(state: PlayerGameView, validActions: ValidAction[]): string {
  return `
    <div class="zone alert-zone">
      <div class="zone-label">Alert</div>
      <div class="zone-cards">
        ${state.you.zones.alert.map((stack) => renderUnitStack(stack, true)).join("")}
        ${state.you.zones.alert.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone reserve-zone">
      <div class="zone-label">Reserve</div>
      <div class="zone-cards">
        ${state.you.zones.reserve.map((stack) => renderUnitStack(stack, true)).join("")}
        ${state.you.zones.reserve.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone resource-zone">
      <div class="zone-label">Resource</div>
      <div class="zone-cards">
        ${state.you.zones.resourceStacks.map((stack, i) => renderResourceStack(stack, true, i)).join("")}
        ${(state.you.zones.persistentMissions ?? []).map((mc) => renderPersistentMission(mc)).join("")}
      </div>
    </div>
  `;
}

function computeThreatLevel(state: PlayerGameView): number {
  let total = 0;
  const zones = [state.you.zones, state.opponent.zones];
  for (const z of zones) {
    for (const stack of [...z.alert, ...z.reserve]) {
      const topCard = stack.cards[0];
      if (!topCard?.faceUp) continue;
      total += getCardCylonThreat(topCard.defId);
    }
  }
  return total;
}

function renderPersistentMission(card: CardInstance): string {
  const def = cardDefs[card.defId];
  const name = def?.subtitle ?? card.defId;
  const image = def?.image;
  return `
    <div class="board-card persistent-mission" data-instance-id="${card.instanceId}" data-def-id="${card.defId}">
      ${image ? `<img src="${image}" alt="${name}" class="card-image" />` : `<div class="card-text-fallback mission"><div class="card-name">${name}</div><div class="card-type">Persistent</div></div>`}
    </div>
  `;
}

function getResourceName(defId: string): string {
  const base = baseDefs[defId];
  if (base) return base.resource;
  const card = cardDefs[defId];
  if (card?.resource) return card.resource;
  return "";
}

function renderResourceStack(stack: ResourceStack, isYours: boolean, stackIndex?: number): string {
  const def = getCardDef(stack.topCard.defId);
  const name = def?.title ?? stack.topCard.defId;
  const exhaustedClass = stack.exhausted ? "exhausted" : "";
  const isBase = !!baseDefs[stack.topCard.defId];
  const image = isBase
    ? baseDefs[stack.topCard.defId]?.image
    : cardDefs[stack.topCard.defId]?.image;
  const resName = getResourceName(stack.topCard.defId);
  const supplyCount = stack.supplyCards.length;
  const totalResource = 1 + supplyCount;
  const resLetter = resName ? resName.charAt(0).toUpperCase() : "?";
  const stackBadge = `<div class="resource-stack-badge resource-stack-badge--${resName}">${totalResource}${resLetter}</div>`;

  if (image) {
    const supplyCards = Array.from(
      { length: supplyCount },
      (_, i) =>
        `<img src="images/cards/bsgbetback.jpg" alt="Supply" class="resource-supply-img" style="z-index: ${-i - 1};" loading="lazy" />`,
    ).join("");
    const displayImage = stack.exhausted
      ? isBase
        ? "images/cards/bsgbetback-landscape.jpg"
        : "images/cards/bsgbetback-portrait.jpg"
      : image;
    const displayAlt = stack.exhausted ? "Spent" : escapeHtml(name);
    return `
      <div class="resource-stack-wrap" data-stack-index="${stackIndex ?? ""}">
        ${supplyCards}
        <div class="resource-card-img ${isBase ? "base-card" : ""} ${exhaustedClass}" data-stack-index="${stackIndex ?? ""}" data-instance-id="${stack.topCard.instanceId}" data-def-id="${stack.topCard.defId}">
          <img src="${displayImage}" alt="${displayAlt}" class="resource-card-thumb${isBase ? " card-clip-landscape" : ""}" loading="lazy" />
          ${stackBadge}
        </div>
      </div>
    `;
  }

  const typeClass = getCardTypeClass(stack.topCard.defId);
  const resIcon = getResourceIcon(stack.topCard.defId);
  const fallbackSupply = Array.from(
    { length: supplyCount },
    (_, i) =>
      `<img src="images/cards/bsgbetback.jpg" alt="Supply" class="resource-supply-img" style="z-index: ${-i - 1};" loading="lazy" />`,
  ).join("");

  if (stack.exhausted) {
    // Show card back when spent
    return `
      <div class="resource-stack-wrap" data-stack-index="${stackIndex ?? ""}">
        ${fallbackSupply}
        <div class="resource-card-img ${exhaustedClass}" data-stack-index="${stackIndex ?? ""}" data-instance-id="${stack.topCard.instanceId}" data-def-id="${stack.topCard.defId}">
          <img src="images/cards/bsgbetback-portrait.jpg" alt="Spent" class="resource-card-thumb" loading="lazy" />
          ${stackBadge}
        </div>
      </div>
    `;
  }

  return `
    <div class="resource-stack-wrap" data-stack-index="${stackIndex ?? ""}">
      ${fallbackSupply}
      <div class="card resource-card ${typeClass}" data-stack-index="${stackIndex ?? ""}" data-instance-id="${stack.topCard.instanceId}" data-def-id="${stack.topCard.defId}">
        <div class="card-name">${escapeHtml(name)}</div>
        <div class="card-resource">${resIcon}</div>
        ${stackBadge}
      </div>
    </div>
  `;
}

function renderUnitStack(stack: UnitStack, isYours: boolean): string {
  const topCard = stack.cards[0];
  if (!topCard) return "";
  const def = getCardDef(topCard.defId);
  const name = def ? getCardName(topCard.defId) : topCard.defId;
  const basePower = def?.power ?? 0;
  const buff = stack.powerBuff ?? 0;
  const totalPower = basePower + buff;
  const buffClass = buff > 0 ? " power-buffed" : "";
  const powerDisplay =
    buff > 0
      ? `${totalPower} <span class="power-buff-indicator">(+${buff})</span>`
      : `${totalPower}`;
  const typeClass = getCardTypeClass(topCard.defId);
  const exhaustedClass = stack.exhausted ? "exhausted" : "";
  const stackSize = stack.cards.length;
  const image = cardDefs[topCard.defId]?.image;

  if (image) {
    return `
      <div class="unit-card-img ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
        <img src="${image}" alt="${escapeHtml(name)}" class="unit-card-thumb" loading="lazy" />
        <div class="unit-power-badge${buffClass}">${totalPower}</div>
        ${stackSize > 1 ? `<div class="unit-stack-badge">x${stackSize}</div>` : ""}
      </div>
    `;
  }

  const cylonThreat = getCardCylonThreat(topCard.defId);
  return `
    <div class="card unit-card ${typeClass} ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
      <div class="card-name">${escapeHtml(name)}</div>
      <div class="card-stats">
        <span class="card-power${buffClass}">${powerDisplay}</span>
        ${cylonThreat > 0 ? `<span class="card-threat">${cylonThreat}</span>` : ""}
      </div>
      ${stackSize > 1 ? `<div class="card-stack-count">x${stackSize}</div>` : ""}
    </div>
  `;
}

function renderHandCard(card: CardInstance, index: number, validActions: ValidAction[]): string {
  const def = cardDefs[card.defId];
  if (!def) return "";

  const name = getCardName(card.defId);

  // Check if this card index is in any valid action
  const playable = validActions.some((a) => a.selectableCardIndices?.includes(index));

  return `
    <div class="hand-card ${playable ? "playable" : ""}" data-card-index="${index}">
      ${def.image ? `<img src="${def.image}" alt="${escapeHtml(name)}" class="hand-card-img" loading="lazy" />` : `<div class="hand-card-ph">${def.type.charAt(0).toUpperCase()}</div>`}
    </div>
  `;
}

function renderCylonThreats(threats: CylonThreatCard[]): string {
  return `
    <div class="cylon-threats">
      <div class="threats-label">CYLON THREATS</div>
      <div class="threats-cards">
        ${threats
          .map(
            (t, i) => `
          <div class="card threat-card" data-threat-index="${i}">
            <div class="card-name">${getCardName(t.card.defId)}</div>
            <div class="card-power threat-power">${t.power}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderActions(
  validActions: ValidAction[],
  state: PlayerGameView,
  aiActing?: boolean,
): string {
  if (validActions.length === 0) {
    if (aiActing) {
      return '<div class="no-actions ai-acting"><div class="spinner-small"></div> Opponent is acting...</div>';
    }
    return '<div class="no-actions">Waiting for opponent...</div>';
  }

  // Action buttons are now shown in the player action modal
  return "";
}

// ============================================================
// Event Listeners
// ============================================================

function attachEventListeners(
  container: HTMLElement,
  validActions: ValidAction[],
  state: PlayerGameView,
): void {
  // Resource card tap-to-preview
  container.querySelectorAll(".resource-card-img[data-def-id]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selectable")) return;
      const defId = (el as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Unit card image tap-to-preview
  container.querySelectorAll(".unit-card-img[data-def-id]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selectable")) return;
      const defId = (el as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Hand scroll indicators
  setupHandScrollIndicators(container);

  // Hand card tap-to-preview with prev/next navigation
  const handDefIds = state.you.hand.map((c) => c.defId);
  container.querySelectorAll(".hand-card").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selectable")) return;
      const idx = parseInt((el as HTMLElement).dataset.cardIndex ?? "-1");
      if (idx >= 0 && idx < handDefIds.length) {
        showCardPreviewNav(handDefIds, idx);
      }
    });
  });

  // Log button
  container.querySelector("#log-btn")?.addEventListener("click", () => {
    showLogModal();
  });

  // New Game button
  container.querySelector("#new-game-btn")?.addEventListener("click", () => {
    if (state.phase === "gameOver") {
      onResetGame?.();
    } else {
      showConfirmResetModal();
    }
  });

  // Discard pile browsers
  container.querySelector("#your-discard-btn")?.addEventListener("click", () => {
    showDiscardBrowser(state.you.discard ?? [], "Your Discard Pile");
  });
  container.querySelector("#opp-discard-btn")?.addEventListener("click", () => {
    showDiscardBrowser(state.opponent.discard ?? [], "Opponent's Discard Pile");
  });

  // Persistent mission tap-to-preview
  container.querySelectorAll(".persistent-mission").forEach((el) => {
    el.addEventListener("click", () => {
      const defId = (el as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });
}

function handleActionClick(
  action: ValidAction,
  validActions: ValidAction[],
  state: PlayerGameView,
  container: HTMLElement,
): void {
  if (!onAction) return;

  switch (action.type) {
    case "keepHand":
      onAction({ type: "keepHand" });
      break;
    case "redraw":
      onAction({ type: "redraw" });
      break;
    case "passResource":
      onAction({ type: "passResource" });
      break;
    case "drawCards":
      onAction({ type: "drawCards" });
      break;
    case "doneReorder":
      onAction({ type: "doneReorder" });
      break;
    case "reorderStack": {
      const stackId = action.selectableInstanceIds?.[0];
      const newTopId = action.cardDefId;
      if (stackId && newTopId) {
        onAction({ type: "reorderStack", stackInstanceId: stackId, newTopDefId: newTopId });
      }
      break;
    }
    case "pass":
      onAction({ type: "pass" });
      break;
    case "challengePass":
      onAction({ type: "challengePass" });
      break;
    case "passCylon":
      onAction({ type: "passCylon" });
      break;

    case "playCard": {
      const cardIdx = action.selectableCardIndices?.[0] ?? 0;
      const targets = action.selectableInstanceIds;
      // If server provided targets for this event, prompt for target selection
      if (targets && targets.length > 0) {
        const card = state.you.hand[cardIdx];
        const def = card ? cardDefs[card.defId] : null;
        const cardLabel = def ? getCardName(card.defId) : "event";
        enterSelectModeInstance(
          container,
          `Select target for ${cardLabel}`,
          targets,
          (targetId) => {
            onAction!({ type: "playCard", cardIndex: cardIdx, targetInstanceId: targetId });
          },
          validActions,
          state,
        );
      } else {
        onAction({ type: "playCard", cardIndex: cardIdx });
      }
      break;
    }

    case "playToResource": {
      const indices = action.selectableCardIndices ?? [];
      const stackIndices = action.selectableStackIndices ?? [];

      // Per-card action: single selectable index, skip hand selection
      if (indices.length === 1) {
        const idx = indices[0];
        const card = state.you.hand[idx];
        if (!card) break;
        const def = cardDefs[card.defId];
        const hasResource = !!def?.resource;

        if (hasResource && stackIndices.length > 0) {
          showResourceDeployChoice(container, idx, stackIndices, state, validActions);
        } else if (hasResource) {
          onAction!({ type: "playToResource", cardIndex: idx, asSupply: false });
        } else if (stackIndices.length > 0) {
          promptSupplyChoice(idx, stackIndices, state, validActions, container);
        }
        break;
      }

      // Fallback: multi-card selection (legacy)
      const handCards = container.querySelectorAll(".hand-card");
      handCards.forEach((el) => {
        const idx = parseInt((el as HTMLElement).dataset.cardIndex ?? "-1");
        if (indices.includes(idx)) {
          el.classList.add("selectable");
          el.addEventListener("click", function handler() {
            el.removeEventListener("click", handler);
            handCards.forEach((el2) => el2.classList.remove("selectable"));

            const card = state.you.hand[idx];
            if (!card) return;
            const def = cardDefs[card.defId];
            const hasResource = !!def?.resource;

            if (hasResource && stackIndices.length > 0) {
              showResourceDeployChoice(container, idx, stackIndices, state, validActions);
            } else if (hasResource) {
              onAction!({ type: "playToResource", cardIndex: idx, asSupply: false });
            } else if (stackIndices.length > 0) {
              promptSupplyChoice(idx, stackIndices, state, validActions, container);
            }
          });
        }
      });

      showPromptModal("Select a card to deploy as a resource", [
        {
          label: "Cancel",
          cancel: true,
          onClick: () => {
            handCards.forEach((el) => el.classList.remove("selectable"));
            restoreActionsBar(container, validActions, state);
          },
        },
      ]);
      break;
    }

    case "challenge": {
      const units = action.selectableInstanceIds ?? [];
      if (units.length === 1) {
        // Per-unit challenge action: send directly
        onAction!({
          type: "challenge",
          challengerInstanceId: units[0],
          opponentIndex: 1 - state.you.playerIndex,
        });
      } else {
        enterSelectModeInstance(
          container,
          "Select a unit to challenge with",
          units,
          (id) => {
            onAction!({
              type: "challenge",
              challengerInstanceId: id,
              opponentIndex: 1 - state.you.playerIndex,
            });
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "defend": {
      if (action.description === "Decline to defend") {
        onAction({ type: "defend", defenderInstanceId: null });
      } else {
        const defenders = action.selectableInstanceIds ?? [];
        if (defenders.length === 1) {
          // Per-defender action: send directly
          onAction!({ type: "defend", defenderInstanceId: defenders[0] });
        } else {
          enterSelectModeInstance(
            container,
            "Select a defender",
            defenders,
            (id) => {
              onAction!({ type: "defend", defenderInstanceId: id });
            },
            validActions,
            state,
          );
        }
      }
      break;
    }

    case "resolveMission": {
      const missions = action.selectableInstanceIds ?? [];
      if (missions.length === 1) {
        onAction({ type: "resolveMission", missionInstanceId: missions[0], unitInstanceIds: [] });
      } else {
        enterSelectModeInstance(
          container,
          "Select a mission to resolve",
          missions,
          (id) => {
            onAction!({ type: "resolveMission", missionInstanceId: id, unitInstanceIds: [] });
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "playAbility": {
      const sources = action.selectableInstanceIds ?? [];
      if (sources.length === 1) {
        // Check if the ability needs a target
        const desc = action.description;
        if (desc.includes("Target unit") || desc.includes("target")) {
          // Need to select a target — get all alert units
          const targetUnits = getAllAlertUnitIds(state);
          enterSelectModeInstance(
            container,
            "Select target for ability",
            targetUnits,
            (targetId) => {
              onAction!({
                type: "playAbility",
                sourceInstanceId: sources[0],
                targetInstanceId: targetId,
              });
            },
            validActions,
            state,
          );
        } else {
          onAction({ type: "playAbility", sourceInstanceId: sources[0] });
        }
      } else {
        enterSelectModeInstance(
          container,
          action.description,
          sources,
          (id) => {
            onAction!({ type: "playAbility", sourceInstanceId: id });
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "playEventInChallenge": {
      const indices = action.selectableCardIndices ?? [];
      const targets = action.selectableInstanceIds;
      if (indices.length === 1) {
        const cardIdx = indices[0];
        // If server provided targets, prompt for target selection
        if (targets && targets.length > 0) {
          const card = state.you.hand[cardIdx];
          const cardLabel = card ? getCardName(card.defId) : "event";
          enterSelectModeInstance(
            container,
            `Select target for ${cardLabel}`,
            targets,
            (targetId) => {
              onAction!({
                type: "playEventInChallenge",
                cardIndex: cardIdx,
                targetInstanceId: targetId,
              });
            },
            validActions,
            state,
          );
        } else {
          onAction({ type: "playEventInChallenge", cardIndex: cardIdx });
        }
      } else {
        // Multiple events selectable — pick card first, then check for targets
        enterSelectMode(
          container,
          "Select event to play",
          indices,
          (idx) => {
            // Find the matching action to get its server-provided targets
            const matchingAction = validActions.find(
              (a) =>
                a.type === "playEventInChallenge" &&
                a.selectableCardIndices?.includes(idx as number),
            );
            const eventTargets = matchingAction?.selectableInstanceIds;
            if (eventTargets && eventTargets.length > 0) {
              const card = state.you.hand[idx];
              const cardLabel = card ? getCardName(card.defId) : "event";
              enterSelectModeInstance(
                container,
                `Select target for ${cardLabel}`,
                eventTargets,
                (targetId) => {
                  onAction!({
                    type: "playEventInChallenge",
                    cardIndex: idx as number,
                    targetInstanceId: targetId,
                  });
                },
                validActions,
                state,
              );
              return;
            }
            onAction!({ type: "playEventInChallenge", cardIndex: idx as number });
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "challengeCylon": {
      const units = action.selectableInstanceIds ?? [];
      enterSelectModeInstance(
        container,
        "Select unit to challenge Cylon threat",
        units,
        (unitId) => {
          const threats = action.selectableThreatIndices ?? [];
          if (threats.length === 1) {
            onAction!({
              type: "challengeCylon",
              challengerInstanceId: unitId,
              threatIndex: threats[0],
            });
          } else {
            // Would need to select which threat — for now pick first
            onAction!({
              type: "challengeCylon",
              challengerInstanceId: unitId,
              threatIndex: threats[0] ?? 0,
            });
          }
        },
        validActions,
        state,
      );
      break;
    }

    case "useTriggeredAbility": {
      // Agro Ship / Flattop: use triggered ability, optionally select target
      const targets = action.selectableInstanceIds ?? [];
      if (targets.length <= 1) {
        onAction({ type: "useTriggeredAbility", targetInstanceId: targets[0] });
      } else {
        enterSelectModeInstance(
          container,
          "Select unit to ready",
          targets,
          (id) => {
            onAction!({ type: "useTriggeredAbility", targetInstanceId: id });
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "declineTrigger":
      onAction({ type: "declineTrigger" });
      break;

    case "makeChoice": {
      // Celestra-style choices: each action button represents a choice
      // Find the index of this action among all makeChoice actions
      const allChoices = validActions.filter((a) => a.type === "makeChoice");
      const choiceIndex = allChoices.indexOf(action);
      onAction({ type: "makeChoice", choiceIndex: choiceIndex >= 0 ? choiceIndex : 0 });
      break;
    }

    case "strafeChoice":
      // Strafe: challenge as personnel or ship — description encodes the choice
      onAction({
        type: "strafeChoice",
        challengeAs: action.description.includes("personnel") ? "personnel" : "ship",
      });
      break;

    case "sacrificeFromStack": {
      // Sacrifice non-top card from unit stack for +1 power
      // Action has selectableInstanceIds[0] = top card instanceId, description tells which card
      const stackId = action.selectableInstanceIds?.[0];
      if (stackId) {
        // Find the stack and its non-top cards
        const stack = [...state.you.zones.alert, ...state.you.zones.reserve].find(
          (s) => s.cards[0]?.instanceId === stackId,
        );
        if (stack && stack.cards.length >= 2) {
          // Just send with the second card (non-top) — the action already encodes which card
          onAction({
            type: "sacrificeFromStack",
            stackInstanceId: stackId,
            cardInstanceId: stack.cards[1].instanceId,
          });
        }
      }
      break;
    }
  }
}

function getAllAlertUnitIds(state: PlayerGameView): string[] {
  const ids: string[] = [];
  for (const stack of state.you.zones.alert) {
    if (stack.cards[0]) ids.push(stack.cards[0].instanceId);
  }
  // Include challenger/defender in challenge
  if (state.challenge) {
    ids.push(state.challenge.challengerInstanceId);
    if (state.challenge.defenderInstanceId) {
      ids.push(state.challenge.defenderInstanceId);
    }
  }
  return [...new Set(ids)];
}

function enterSelectMode(
  container: HTMLElement,
  prompt: string,
  selectableIndices: number[],
  callback: (index: number) => void,
  validActions?: ValidAction[],
  state?: PlayerGameView,
): void {
  // Highlight selectable hand cards
  const handCards = container.querySelectorAll(".hand-card");
  handCards.forEach((el) => {
    const idx = parseInt((el as HTMLElement).dataset.cardIndex ?? "-1");
    if (selectableIndices.includes(idx)) {
      el.classList.add("selectable");
      el.addEventListener("click", () => {
        callback(idx);
      });
    }
  });

  showPromptModal(`${prompt} — tap a highlighted card`, [
    {
      label: "Cancel",
      cancel: true,
      onClick: () => {
        handCards.forEach((el) => el.classList.remove("selectable"));
        if (validActions && state) {
          restoreActionsBar(container, validActions, state);
        }
      },
    },
  ]);
}

function enterSelectModeInstance(
  container: HTMLElement,
  prompt: string,
  selectableIds: string[],
  callback: (id: string) => void,
  validActions?: ValidAction[],
  state?: PlayerGameView,
): void {
  // Highlight selectable board cards (text cards and image-based unit cards)
  const allCards = container.querySelectorAll("[data-instance-id]");
  allCards.forEach((el) => {
    const id = (el as HTMLElement).dataset.instanceId;
    if (id && selectableIds.includes(id)) {
      el.classList.add("selectable");
      el.addEventListener("click", () => {
        callback(id);
      });
    }
  });

  showPromptModal(`${prompt} — tap a highlighted card`, [
    {
      label: "Cancel",
      cancel: true,
      onClick: () => {
        allCards.forEach((el) => el.classList.remove("selectable"));
        if (validActions && state) {
          restoreActionsBar(container, validActions, state);
        }
      },
    },
  ]);
}

function setupHandScrollIndicators(container: HTMLElement): void {
  const handCards = container.querySelector<HTMLElement>("#hand-cards");
  const leftHint = container.querySelector<HTMLElement>("#hand-scroll-left");
  const rightHint = container.querySelector<HTMLElement>("#hand-scroll-right");
  if (!handCards || !leftHint || !rightHint) return;

  function update() {
    if (!handCards || !leftHint || !rightHint) return;
    const canLeft = handCards.scrollLeft > 1;
    const canRight = handCards.scrollLeft < handCards.scrollWidth - handCards.clientWidth - 1;
    leftHint.classList.toggle("visible", canLeft);
    rightHint.classList.toggle("visible", canRight);
  }

  handCards.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  // Initial check after layout settles
  requestAnimationFrame(update);
  // Re-check after images load (scroll width changes when images render)
  handCards.querySelectorAll("img").forEach((img) => {
    if (!img.complete) {
      img.addEventListener("load", update, { once: true });
    }
  });
  // Fallback delayed check
  setTimeout(update, 300);
}

function showResourceDeployChoice(
  container: HTMLElement,
  cardIndex: number,
  stackIndices: number[],
  state: PlayerGameView,
  validActions: ValidAction[],
): void {
  const card = state.you.hand[cardIndex];
  const cardName = card ? getCardName(card.defId) : "card";

  const stackButtons = stackIndices.map((si) => {
    const stack = state.you.zones.resourceStacks[si];
    const stackName = getCardName(stack.topCard.defId);
    const resName = getResourceName(stack.topCard.defId);
    const totalResource = 1 + stack.supplyCards.length;
    const resLetter = resName ? resName.charAt(0).toUpperCase() : "?";
    return {
      label: `Supply to ${stackName}`,
      cardDefId: stack.topCard.defId,
      badge: { resName, total: totalResource, letter: resLetter },
      onClick: () => {
        onAction!({ type: "playToResource", cardIndex, asSupply: true, targetStackIndex: si });
      },
    };
  });

  showPromptModal(`Deploy ${cardName}:`, [
    {
      label: "Start new resource pile",
      onClick: () => {
        onAction!({ type: "playToResource", cardIndex, asSupply: false });
      },
    },
    ...stackButtons,
    {
      label: "Cancel",
      cancel: true,
      onClick: () => {
        restoreActionsBar(container, validActions, state);
      },
    },
  ]);
}

/** Prompt to choose which stack to place a no-resource card under as supply. */
function promptSupplyChoice(
  cardIndex: number,
  stackIndices: number[],
  state: PlayerGameView,
  validActions: ValidAction[],
  container: HTMLElement,
): void {
  const card = state.you.hand[cardIndex];
  const name = card ? getCardName(card.defId) : "card";

  const stackButtons = stackIndices.map((si) => {
    const stack = state.you.zones.resourceStacks[si];
    const stackName = getCardName(stack.topCard.defId);
    const resName = getResourceName(stack.topCard.defId);
    const totalResource = 1 + stack.supplyCards.length;
    const resLetter = resName ? resName.charAt(0).toUpperCase() : "?";
    return {
      label: `Supply to ${stackName}`,
      cardDefId: stack.topCard.defId,
      badge: { resName, total: totalResource, letter: resLetter },
      onClick: () => {
        onAction!({ type: "playToResource", cardIndex, asSupply: true, targetStackIndex: si });
      },
    };
  });

  showPromptModal(`Deploy ${name} as supply:`, [
    ...stackButtons,
    {
      label: "Cancel",
      cancel: true,
      onClick: () => {
        restoreActionsBar(container, validActions, state);
      },
    },
  ]);
}

function restoreActionsBar(
  container: HTMLElement,
  validActions: ValidAction[],
  state: PlayerGameView,
): void {
  // Remove all selectable highlights
  container.querySelectorAll(".selectable").forEach((el) => el.classList.remove("selectable"));

  // Clear any select prompts from actions bar
  const actionsBar = container.querySelector("#actions-bar");
  if (actionsBar) actionsBar.innerHTML = "";

  // Re-show the player action modal
  showPlayerActionModal(validActions, state, container);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
