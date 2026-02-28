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
    .replace(new RegExp(youLabel, "g"), "You")
    .replace(new RegExp(oppLabel, "g"), "Opponent");
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

  container.innerHTML = `
    <div class="game-board">
      <div class="info-bar">
        <div class="info-bar-left">
          <span class="info-item">T${state.turn}</span>
          <span class="info-item phase">${formatPhase(state.phase, state.readyStep)}</span>
          <span class="info-item ${isYourTurn ? "your-turn" : "opp-turn"}">${isYourTurn ? "YOU" : "OPP"}</span>
          <span class="info-item">Fleet: ${state.fleetDefenseLevel}</span>
        </div>
        <div class="info-bar-right">
          <button class="header-btn" id="actions-fab" style="display:none">Actions</button>
          <button class="header-btn" id="log-btn">Log</button>
        </div>
      </div>

      <div class="influence-bar">
        <div class="influence you">You: ${state.you.influence} influence</div>
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
          <div class="board-label">YOU (Player ${state.you.playerIndex + 1})</div>
          ${renderYourZones(state, validActions)}
        </div>
      </div>

      ${state.cylonThreats.length > 0 ? renderCylonThreats(state.cylonThreats) : ""}

      <div class="hand-area">
        <div class="hand-label">HAND (${state.you.hand.length} cards) | Deck: ${state.you.deckCount} | Discard: ${state.you.discardCount}</div>
        <div class="hand-label opp-info">Opponent — Hand: ${state.opponent.handCount} | Deck: ${state.opponent.deckCount} | Discard: ${state.opponent.discardCount}</div>
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

  // Attach event listeners
  attachEventListeners(container, validActions, state);

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
  // Remove any existing modal
  document.querySelector(".action-modal-overlay")?.remove();

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

  // Format notification text lines (replace Player labels)
  const textLines = notification.text
    .split("\n")
    .map((line: string) => escapeHtml(formatLogForDisplay(line, playerIndex)))
    .join("<br>");

  const overlay = document.createElement("div");
  overlay.className = "action-modal-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-top">
        <div class="action-modal-text">${textLines}</div>
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

function showLogModal(): void {
  // Remove any existing log modal
  document.querySelector(".log-modal-overlay")?.remove();

  const logHtml = currentLog
    .map(
      (l) =>
        `<div class="log-entry">${escapeHtml(formatLogForDisplay(l, currentPlayerIndex))}</div>`,
    )
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

  // Scroll to bottom
  const body = overlay.querySelector(".log-modal-body");
  if (body) body.scrollTop = body.scrollHeight;
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
  let headerText = "Choose an action";
  if (state.challenge) {
    const isChallenger = state.challenge.challengerPlayerIndex === state.you.playerIndex;
    const role = isChallenger ? "You are the challenger" : "You are the defender";
    const context = state.challenge.waitingForDefender
      ? " — Choose a defender or decline"
      : state.challenge.step === 2
        ? " — Play effects or pass"
        : "";
    headerText = `CHALLENGE: ${role}${context}`;
  } else if (state.phase === "ready" && state.readyStep === 4) {
    headerText = "Deploy a card to resource area";
  } else if (state.phase === "cylon") {
    headerText = "Cylon phase";
  }

  const buttonsHtml = validActions
    .map((a, i) => {
      const disabledClass = a.disabled ? " action-modal-btn--disabled" : "";
      const thumbHtml = getActionThumbHtml(a);
      if (thumbHtml) {
        return `<div class="action-row${a.disabled ? " action-row--disabled" : ""}"><button class="action-modal-btn action-modal-btn--with-thumb${disabledClass}" data-action-index="${i}">${escapeHtml(a.description)}</button>${thumbHtml}</div>`;
      }
      return `<button class="action-modal-btn${disabledClass}" data-action-index="${i}">${escapeHtml(a.description)}</button>`;
    })
    .join("");

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
  buttons: { label: string; onClick: () => void; cancel?: boolean; cardDefId?: string }[],
): void {
  dismissPlayerActionModal();

  const buttonsHtml = buttons
    .map((b, i) => {
      const btnClass = `action-modal-btn${b.cancel ? " cancel-modal-btn" : ""}${b.cardDefId ? " action-modal-btn--with-thumb" : ""}`;
      const btnHtml = `<button class="${btnClass}" data-btn-index="${i}">${escapeHtml(b.label)}</button>`;
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
      </div>
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
  const power = def?.power ?? 0;
  const typeClass = getCardTypeClass(topCard.defId);
  const exhaustedClass = stack.exhausted ? "exhausted" : "";
  const stackSize = stack.cards.length;
  const image = cardDefs[topCard.defId]?.image;

  if (image) {
    return `
      <div class="unit-card-img ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
        <img src="${image}" alt="${escapeHtml(name)}" class="unit-card-thumb" loading="lazy" />
        <div class="unit-power-badge">${power}</div>
        ${stackSize > 1 ? `<div class="unit-stack-badge">x${stackSize}</div>` : ""}
      </div>
    `;
  }

  const cylonThreat = getCardCylonThreat(topCard.defId);
  return `
    <div class="card unit-card ${typeClass} ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
      <div class="card-name">${escapeHtml(name)}</div>
      <div class="card-stats">
        <span class="card-power">${power}</span>
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
      // If there's exactly one selectable card, play it directly
      if (action.selectableCardIndices?.length === 1) {
        onAction({ type: "playCard", cardIndex: action.selectableCardIndices[0] });
      } else {
        enterSelectMode(
          container,
          "Select a card to play",
          action.selectableCardIndices ?? [],
          (idx) => {
            onAction!({ type: "playCard", cardIndex: idx as number });
          },
          validActions,
          state,
        );
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
          promptSupplyChoice(idx, stackIndices, state, validActions);
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
              promptSupplyChoice(idx, stackIndices, state, validActions);
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
      if (indices.length === 1) {
        // Check if event needs a target
        const card = state.you.hand[indices[0]];
        if (card) {
          const def = cardDefs[card.defId];
          if (def?.abilityText.includes("Target") || def?.abilityText.includes("target")) {
            const targetUnits = getAllAlertUnitIds(state);
            enterSelectModeInstance(
              container,
              "Select target",
              targetUnits,
              (targetId) => {
                onAction!({
                  type: "playEventInChallenge",
                  cardIndex: indices[0],
                  targetInstanceId: targetId,
                });
              },
              validActions,
              state,
            );
          } else {
            onAction({ type: "playEventInChallenge", cardIndex: indices[0] });
          }
        }
      } else {
        enterSelectMode(
          container,
          "Select event to play",
          indices,
          (idx) => {
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
    const supplyCount = stack.supplyCards.length;
    return {
      label: `Supply to ${stackName} (${supplyCount} supply)`,
      cardDefId: stack.topCard.defId,
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
): void {
  const card = state.you.hand[cardIndex];
  const name = card ? getCardName(card.defId) : "card";

  const stackButtons = stackIndices.map((si) => {
    const stack = state.you.zones.resourceStacks[si];
    const stackName = getCardName(stack.topCard.defId);
    const supplyCount = stack.supplyCards.length;
    return {
      label: `Supply to ${stackName} (${supplyCount} supply)`,
      cardDefId: stack.topCard.defId,
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
        restoreActionsBar(document.getElementById("game-container")!, validActions, state);
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
