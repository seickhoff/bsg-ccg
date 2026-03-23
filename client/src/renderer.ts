import type {
  PlayerGameView,
  ValidAction,
  GameAction,
  CardInstance,
  ResourceStack,
  UnitStack,
  PlayerZones,
  CardDef,
  BaseCardDef,
  CardRegistry,
  OpponentView,
  CylonThreatCard,
  ActionNotification,
  LogItem,
  ChallengeState,
  Trait,
  Keyword,
} from "@bsg/shared";
import { cardName } from "@bsg/shared";
import {
  setPreviewRegistry,
  showCardPreview,
  showCardPreviewNav,
  type CardRuntimeInfo,
  type ScopedMod,
} from "./card-preview.js";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, DRAG_THRESHOLD } from "./constants.js";
import { escapeHtml } from "./utils.js";

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
let currentLog: LogItem[] = [];
let currentPlayerIndex = 0;
let savedModalPosition: { top: number; left: number } | null = null;
let boardZoomPercent = parseInt(localStorage.getItem("boardZoomPercent") ?? "0", 10); // 0–100 in 5% steps
let savedBoardScrollTop = 0;
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
  return cardName(def);
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

/** Find a unit stack by its top card's instanceId across a player's zones. */
function findUnitStack(zones: PlayerZones, instanceId: string): UnitStack | null {
  for (const stack of [...zones.alert, ...zones.reserve]) {
    if (stack.cards[0]?.instanceId === instanceId) return stack;
  }
  return null;
}

/** Build runtime info for the card preview overlay from current game state. */
function buildRuntimeInfo(instanceId: string, state: PlayerGameView): CardRuntimeInfo | undefined {
  const yourStack = findUnitStack(state.you.zones, instanceId);
  const oppStack = findUnitStack(state.opponent.zones, instanceId);
  const stack = yourStack ?? oppStack;
  if (!stack) return undefined;
  const topCard = stack.cards[0];
  if (!topCard) return undefined;

  let challengeBuff = 0;
  if (state.challenge && topCard.instanceId === state.challenge.challengerInstanceId) {
    challengeBuff = state.challenge.challengerPowerBuff ?? 0;
  } else if (state.challenge && topCard.instanceId === state.challenge.defenderInstanceId) {
    challengeBuff = state.challenge.defenderPowerBuff ?? 0;
  }

  const rt: CardRuntimeInfo = {};
  if (stack.powerBuff) rt.powerBuff = stack.powerBuff;
  const passiveBuff = state.passivePowerBuffs?.[instanceId] ?? 0;
  if (passiveBuff) rt.passivePowerBuff = passiveBuff;
  if (challengeBuff) rt.challengeBuff = challengeBuff;

  // Build scoped trait grants
  const grantedTraits: ScopedMod<Trait>[] = [];
  for (const t of state.phaseTraitGrants?.[instanceId] ?? [])
    grantedTraits.push({ value: t, scope: "phase" });
  for (const t of state.turnTraitGrants?.[instanceId] ?? [])
    grantedTraits.push({ value: t, scope: "turn" });
  if (grantedTraits.length) rt.grantedTraits = grantedTraits;

  // Build scoped trait removals
  const removedTraits: ScopedMod<Trait>[] = [];
  for (const t of state.phaseTraitRemovals?.[instanceId] ?? [])
    removedTraits.push({ value: t, scope: "phase" });
  for (const t of state.turnTraitRemovals?.[instanceId] ?? [])
    removedTraits.push({ value: t, scope: "turn" });
  if (removedTraits.length) rt.removedTraits = removedTraits;

  // Build scoped keyword grants
  const grantedKeywords: ScopedMod<Keyword>[] = [];
  for (const t of state.phaseKeywordGrants?.[instanceId] ?? [])
    grantedKeywords.push({ value: t, scope: "phase" });
  for (const t of state.turnKeywordGrants?.[instanceId] ?? [])
    grantedKeywords.push({ value: t, scope: "turn" });
  if (grantedKeywords.length) rt.grantedKeywords = grantedKeywords;

  if (stack.exhausted) rt.exhausted = true;
  if (stack.cards.length > 1) rt.stackSize = stack.cards.length;
  const immunity = state.effectImmunity?.[instanceId];
  if (immunity) rt.effectImmunity = immunity;

  // Only return if there's something to show
  if (Object.keys(rt).length === 0) return undefined;
  return rt;
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

const RESOURCE_ICONS: Record<string, string> = {
  persuasion: "P",
  logistics: "L",
  security: "S",
};

function resourceIcon(type: string): string {
  return RESOURCE_ICONS[type] ?? "?";
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

function powerBadgeHtml(
  instanceId: string,
  zones: PlayerZones,
  passiveBuffs?: Record<string, number>,
): string {
  const stack = findUnitStack(zones, instanceId);
  if (!stack) return "";
  const def = getCardDef(stack.cards[0]?.defId ?? "");
  const basePower = def?.power ?? 0;
  const buff = (stack.powerBuff ?? 0) + (passiveBuffs?.[instanceId] ?? 0);
  const total = basePower + buff;
  const buffStr = buff > 0 ? `+${buff}` : buff < 0 ? `${buff}` : "";
  const label = buff !== 0 ? `${basePower}${buffStr}=${total}` : `${total}`;
  return `<span class="resource-inline-badge resource-inline-badge--power">${label}</span>`;
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

function makeChoiceBadgeHtml(defId: string, state: PlayerGameView): string {
  // If it matches a resource stack, show stack resource type + size
  const stack = state.you.zones.resourceStacks.find((s) => s.topCard.defId === defId);
  if (stack) {
    const resName = getResourceName(stack.topCard.defId);
    const total = 1 + stack.supplyCards.length;
    const letter = resName ? resName.charAt(0).toUpperCase() : "?";
    return `<span class="resource-inline-badge resource-inline-badge--${resName || "supply"}">${total}${letter}</span>`;
  }
  // Otherwise show card's deploy cost + power (for hand card choices)
  const def = cardDefs[defId];
  if (!def) return "";
  let badges = costBadgeHtml(def.cost);
  if (def.power != null) {
    badges += `${badges ? " " : ""}<span class="resource-inline-badge resource-inline-badge--power">${def.power}</span>`;
  }
  return badges;
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

function formatLogForDisplay(entry: string, _yourPlayerIndex: number): string {
  return entry;
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

/** Replace known card names in escaped HTML with clickable preview links.
 *  Accepts an optional defId list to scope the search; otherwise uses all known cards. */
function linkifyCardNames(html: string, defIdList?: string[]): string {
  const nameToDefId = new Map<string, string>();
  if (defIdList) {
    for (const defId of defIdList) {
      const name = getCardName(defId);
      if (name && name !== defId) nameToDefId.set(name, defId);
    }
  } else {
    // Build from all known card/base defs
    for (const defId of Object.keys(cardDefs)) {
      const name = getCardName(defId);
      if (name && name !== defId) nameToDefId.set(name, defId);
    }
    for (const defId of Object.keys(baseDefs)) {
      const name = getCardName(defId);
      if (name && name !== defId) nameToDefId.set(name, defId);
    }
  }
  if (nameToDefId.size === 0) return html;
  // Sort by length descending so longer names match first (e.g. "Apollo, Commander Air Group" before "Apollo")
  const names = [...nameToDefId.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const defId = nameToDefId.get(name)!;
    const escaped = escapeHtml(name);
    html = html.replace(
      new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      `<span class="notif-card-link" data-def-id="${defId}">${escaped}</span>`,
    );
  }
  return html;
}

function formatNotificationHtml(
  text: string,
  playerIndex: number,
  cardDefIdList?: string[],
): string {
  const rawLines = text.split("\n").map((line) => {
    // Strip timestamp prefix [HH:MM:SS]
    const stripped = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    return formatLogForDisplay(stripped, playerIndex);
  });

  // Merge "(Paid ...)" lines into the following action line as cost tags
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (/^\(Paid /.test(rawLines[i]) && i + 1 < rawLines.length && rawLines[i + 1].trim()) {
      // Parse cost from "(Paid 2 logistics, 1 security)" format
      const costObj: Record<string, number> = {};
      const costMatches = rawLines[i].matchAll(/(\d+)\s+(persuasion|logistics|security)/g);
      for (const m of costMatches) costObj[m[2]] = parseInt(m[1]);
      const badge = Object.keys(costObj).length > 0 ? ` ${costBadgeHtml(costObj)}` : "";
      lines.push(`\x00${escapeHtml(rawLines[i + 1])}${badge}`); // \x00 = pre-escaped marker
      i++; // skip the next line since we merged it
    } else {
      lines.push(rawLines[i]);
    }
  }

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
    } else if (
      /Challenger wins|Defender wins|Challenger total:|Defender total:|Challenger .+: power|Defender .+: power|is defeated|Challenge ends\.|Undefended!|── Resolution ──|reveals .+\(mystic value|passes in the challenge|Discourage Pursuit|Dr\. Cottle|exhausted instead/i.test(
        line,
      )
    ) {
      ensureSection("Challenge Result").items.push(line);
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
        // Lines starting with \x00 are already escaped with badge HTML
        const html = item.startsWith("\x00") ? item.slice(1) : escapeHtml(item);
        parts.push(
          `<div class="notif-item"><span>${linkifyCardNames(html, cardDefIdList)}</span></div>`,
        );
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
  log: LogItem[],
  aiActing?: boolean,
  notification?: ActionNotification,
): void {
  selectMode = null;
  const isYourTurn = state.activePlayerIndex === state.you.playerIndex;
  const opponentName = state.playerNames[1 - state.you.playerIndex];
  currentLog = log;
  currentPlayerIndex = state.you.playerIndex;

  // Preserve play-area scroll position across re-renders
  const prevBoards = container.querySelector(".boards");
  if (prevBoards) savedBoardScrollTop = prevBoards.scrollTop;
  const scrollToRestore = savedBoardScrollTop;

  container.innerHTML = `
    <div class="game-board">
      <div class="info-bar">
        <div class="info-bar-left">
          <span class="info-item">T${state.turn}</span>
          <span class="info-item phase">${formatPhase(state.phase, state.readyStep)}</span>
          <span class="info-item ${isYourTurn ? "your-turn" : "opp-turn"}">${isYourTurn ? "YOU" : "OPP"}</span>
          <span class="info-item">Fleet: ${state.fleetDefenseLevel + (state.fleetDefenseModifier ?? 0)}${state.fleetDefenseModifier ? ` (${state.fleetDefenseLevel}${state.fleetDefenseModifier > 0 ? "+" : ""}${state.fleetDefenseModifier})` : ""}</span>
          <span class="info-item threat-level">Threat: ${computeThreatLevel(state)}</span>
        </div>
        <div class="info-bar-right">
          <div class="zoom-control" id="zoom-control">
            <button class="zoom-btn" id="zoom-out">&minus;</button>
            <span class="zoom-label" id="zoom-label">${boardZoomPercent}%</span>
            <button class="zoom-btn" id="zoom-in">+</button>
          </div>
          <button class="header-btn" id="log-btn">Log</button>
          <button class="header-btn" id="new-game-btn">New Game</button>
        </div>
      </div>

      <div class="influence-bar">
        <div class="influence you">${escapeHtml(playerName)}: ${state.you.influence} influence</div>
        <div class="influence opp">${escapeHtml(opponentName)}: ${state.opponent.influence} influence</div>
      </div>

      ${state.winner !== null ? renderWinner(state) : ""}

      <div class="boards">
        <div class="opponent-board">
          <div class="board-label">${escapeHtml(opponentName.toUpperCase())}</div>
          ${renderOpponentZones(state.opponent, state.challenge, state.traitGrants, state.keywordGrants, state.traitRemovals, state.effectImmunity, state.passivePowerBuffs)}
        </div>

        <div class="divider"></div>

        <div class="your-board">
          <div class="board-label">${escapeHtml(playerName.toUpperCase())}</div>
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

  // Attach event listeners (also applies zoom)
  attachEventListeners(container, validActions, state);

  // Restore play-area scroll position AFTER zoom is applied
  const newBoards = container.querySelector(".boards");
  if (newBoards) newBoards.scrollTop = scrollToRestore;

  // Dismiss stale overlays before showing new ones
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
  _log: LogItem[],
  playerIndex: number,
): void {
  // Remove any existing modals (both notification and player-action)
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

  // Format notification as structured summary — don't restrict linkification
  // to specific defIds so all card names mentioned in the text are clickable
  const summaryHtml = formatNotificationHtml(notification.text, playerIndex);

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-drag-handle" style="cursor:grab;user-select:none;padding:8px 1rem;background:#222;border-bottom:1px solid #444;border-radius:8px 8px 0 0;color:#e0e0e0;font-size:0.9rem;">
        Action Summary
      </div>
      <div class="action-modal-top">
        <div class="action-modal-text">${summaryHtml}</div>
        ${thumbsHtml ? `<div class="action-modal-thumbs">${thumbsHtml}</div>` : ""}
        <button class="action-modal-continue">Continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  attachModalDragBehavior(overlay);

  // Wire thumbnail clicks → card preview
  overlay.querySelectorAll(".action-modal-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (thumb as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Wire inline card name links → card preview
  overlay.querySelectorAll(".notif-card-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (link as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Wire Continue button
  overlay.querySelector(".action-modal-continue")?.addEventListener("click", () => {
    removeOverlay(overlay);
    if (onContinue) onContinue();
  });
}

function formatLogEntry(raw: LogItem, playerIndex: number): string {
  const isObj = typeof raw !== "string";
  const rawMsg = isObj ? raw.msg : raw;
  const depth = isObj ? (raw.d ?? 0) : 0;
  const cat = isObj ? (raw.cat ?? "") : "";

  const tsMatch = rawMsg.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
  const ts = tsMatch ? tsMatch[1] : "";
  const text = tsMatch ? rawMsg.slice(tsMatch[0].length) : rawMsg;
  const formatted = escapeHtml(formatLogForDisplay(text, playerIndex));

  const classes = ["log-entry"];
  if (depth > 0) classes.push(`log-d${depth}`);
  if (cat) classes.push(`log-${cat}`);

  return `<div class="${classes.join(" ")}"><span class="log-ts">${ts}</span>${formatted}</div>`;
}

const CHALLENGE_KEYWORDS = [
  "defends with",
  "declines to defend",
  "flash plays",
  "during challenge",
];

function extractChallengeLogEntries(): { text: string; isSub: boolean }[] {
  const results: { text: string; isSub: boolean }[] = [];
  for (let i = currentLog.length - 1; i >= 0; i--) {
    const entry = currentLog[i];
    const stripTs = (s: string) => s.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    if (typeof entry === "string") {
      const raw = stripTs(entry);
      if (CHALLENGE_KEYWORDS.some((kw) => raw.includes(kw))) {
        results.push({ text: formatLogForDisplay(raw, currentPlayerIndex), isSub: true });
      }
    } else {
      if (entry.d === 0 && entry.cat === "flow" && entry.msg.includes("challenges")) {
        results.push({
          text: formatLogForDisplay(stripTs(entry.msg), currentPlayerIndex),
          isSub: false,
        });
        break;
      }
      if (entry.d === 1) {
        results.push({
          text: formatLogForDisplay(stripTs(entry.msg), currentPlayerIndex),
          isSub: true,
        });
      }
    }
  }
  return results.reverse();
}

function buildChallengeSummaryHtml(): string {
  const entries = extractChallengeLogEntries();
  if (entries.length === 0) return "";
  const lines = entries
    .map((e) => {
      const cls = e.isSub
        ? "challenge-history-entry challenge-history-sub"
        : "challenge-history-entry";
      return `<div class="${cls}">${linkifyCardNames(escapeHtml(e.text))}</div>`;
    })
    .join("");
  return `<div class="challenge-history-summary">${lines}</div>`;
}

function showLogModal(): void {
  // Remove any existing log modal
  removeOverlay(document.querySelector(".log-modal-overlay"));

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
    if (e.target === overlay) removeOverlay(overlay);
  });

  // Close button
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    removeOverlay(overlay);
  });
}

function showConfirmResetModal(): void {
  removeOverlay(document.querySelector(".log-modal-overlay"));

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
    if (e.target === overlay) removeOverlay(overlay);
  });
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    removeOverlay(overlay);
  });
  overlay.querySelector("#confirm-reset-no")?.addEventListener("click", () => {
    removeOverlay(overlay);
  });
  overlay.querySelector("#confirm-reset-yes")?.addEventListener("click", () => {
    removeOverlay(overlay);
    onResetGame?.();
  });
}

function showDiscardBrowser(cards: CardInstance[], title: string): void {
  removeOverlay(document.querySelector(".log-modal-overlay"));

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
    if (e.target === overlay) removeOverlay(overlay);
  });
  overlay.querySelector(".log-modal-close")?.addEventListener("click", () => {
    removeOverlay(overlay);
  });
  // Click on card entry to show preview
  overlay.querySelectorAll(".discard-card-entry").forEach((el) => {
    el.addEventListener("click", () => {
      const defId = (el as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });
}

function saveBoardScroll(): void {
  const boards = document.querySelector(".boards");
  if (boards) savedBoardScrollTop = boards.scrollTop;
}

function restoreBoardScroll(): void {
  const boards = document.querySelector(".boards");
  if (boards) boards.scrollTop = savedBoardScrollTop;
}

/** Remove a DOM element while preserving .boards scroll position (mobile fix). */
function removeOverlay(el: Element | null): void {
  if (!el) return;
  saveBoardScroll();
  el.remove();
  restoreBoardScroll();
}

function dismissPlayerActionModal(): void {
  removeOverlay(document.querySelector(".player-action-overlay"));
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

/** Shared drag/collapse/position behavior for all action modals.
 *  Expects the overlay to contain .action-modal > .action-modal-drag-handle + .action-modal-top */
function attachModalDragBehavior(overlay: HTMLElement): void {
  const modal = overlay.querySelector(".action-modal") as HTMLElement;
  const dragHandle = overlay.querySelector(".action-modal-drag-handle") as HTMLElement;
  const modalBody = overlay.querySelector(".action-modal-top") as HTMLElement;
  if (!modal || !dragHandle || !modalBody) return;

  // Restore saved position if available
  if (savedModalPosition) {
    modal.style.top = savedModalPosition.top + "px";
    modal.style.left = savedModalPosition.left + "px";
    modal.style.transform = "none";
    modal.style.maxHeight = window.innerHeight - savedModalPosition.top + "px";
  }

  let dragged = false;

  function dragTo(newTop: number, newLeft: number) {
    const handleH = dragHandle.offsetHeight;
    const modalW = modal.offsetWidth;
    const maxTop = window.innerHeight - handleH;
    const maxLeft = window.innerWidth - modalW;
    const clampedTop = Math.max(0, Math.min(newTop, maxTop));
    const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
    modal.style.top = clampedTop + "px";
    modal.style.left = clampedLeft + "px";
    modal.style.transform = "none";
    modal.style.maxHeight = window.innerHeight - clampedTop + "px";
  }

  function toggleCollapse() {
    const hidden = modalBody.style.display === "none";
    modalBody.style.display = hidden ? "" : "none";
    if (hidden) {
      const top = modal.getBoundingClientRect().top;
      modal.style.maxHeight = window.innerHeight - top + "px";
    }
  }

  function savePosition() {
    savedModalPosition = {
      top: modal.getBoundingClientRect().top,
      left: modal.getBoundingClientRect().left,
    };
  }

  // Desktop: drag in any direction (mouse)
  dragHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragged = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = modal.getBoundingClientRect();
    const startTop = rect.top;
    const startLeft = rect.left;
    if (modal.style.transform !== "none") {
      modal.style.left = startLeft + "px";
      modal.style.transform = "none";
    }
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragged = true;
      if (dragged) dragTo(startTop + dy, startLeft + dx);
    };
    const onMouseUp = () => {
      dragHandle.style.cursor = "grab";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (dragged) {
        savePosition();
      } else {
        toggleCollapse();
      }
    };
    dragHandle.style.cursor = "grabbing";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Mobile: vertical drag only (touch)
  dragHandle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    dragged = false;
    const startY = e.touches[0].clientY;
    const rect = modal.getBoundingClientRect();
    const startTop = rect.top;
    const startLeft = rect.left;
    const onTouchMove = (ev: TouchEvent) => {
      if (Math.abs(ev.touches[0].clientY - startY) > DRAG_THRESHOLD) dragged = true;
      if (dragged) dragTo(startTop + (ev.touches[0].clientY - startY), startLeft);
    };
    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      if (dragged) {
        savePosition();
      } else {
        toggleCollapse();
      }
    };
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
  });
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
    const hasChallengers = validActions.some((a) => a.type === "challengeCylon");
    headerText = hasChallengers
      ? "CYLON ATTACK — Send a unit to fight or stand down"
      : "CYLON ATTACK — No units available";
  } else if (state.phase === "execution") {
    const resSummary = buildResourceSummaryHtml(state.you.zones.resourceStacks);
    const total = state.extraActionsTotal ?? 0;
    const remaining = state.extraActionsRemaining ?? 0;
    const extraBadge =
      total > 0
        ? ` <span class="extra-action-badge">Extra Action ${total - remaining} of ${total}</span>`
        : "";
    headerText = `${playerName} — Execution phase${extraBadge}${resSummary}`;
  }

  // Override header for Strafe type choice
  if (validActions.length > 0 && validActions.every((a) => a.type === "strafeChoice")) {
    const strafeDefId = validActions[0].cardDefId;
    const strafeDef = strafeDefId ? cardDefs[strafeDefId] : null;
    const strafeName = strafeDef ? getCardName(strafeDefId!) : "unit";
    headerText = `Strafe — Challenge as? <span class="notif-card-link" data-def-id="${strafeDefId}">${escapeHtml(strafeName)}</span>`;
  }

  // Override header for pending choices (all-makeChoice actions)
  if (validActions.length > 0 && validActions.every((a) => a.type === "makeChoice")) {
    if (state.choicePrompt) {
      headerText = state.choicePrompt;
    } else {
      headerText = `${playerName} — Make a choice`;
    }
  }

  // During execution phase, hide disabled actions and group by card type
  const isStrafeChoice =
    validActions.length > 0 && validActions.every((a) => a.type === "strafeChoice");
  const isExecution = state.phase === "execution" && !state.challenge && !isStrafeChoice;
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
        let badge = "";
        if (a.type === "challenge" && a.selectableInstanceIds?.length === 1) {
          badge = powerBadgeHtml(
            a.selectableInstanceIds[0],
            state.you.zones,
            state.passivePowerBuffs,
          );
        } else if (a.type === "makeChoice" && a.cardDefId) {
          badge = makeChoiceBadgeHtml(a.cardDefId, state);
        } else if (def) {
          badge = costBadgeHtml(def.cost);
        }
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
        // Add resource badge for deploy-to-resource actions or resource stack choices
        let badge = "";
        if (a.type === "strafeChoice" && a.selectableInstanceIds?.length === 1) {
          badge = powerBadgeHtml(
            a.selectableInstanceIds[0],
            state.you.zones,
            state.passivePowerBuffs,
          );
        } else if (a.type === "playToResource" && a.cardDefId) {
          badge = resourceBadgeHtml(a.cardDefId);
        } else if (a.type === "makeChoice" && a.cardDefId) {
          badge = makeChoiceBadgeHtml(a.cardDefId, state);
        }
        const labelHtml = escapeHtml(a.description) + (badge ? ` ${badge}` : "");
        if (thumbHtml) {
          return `<div class="action-row${a.disabled ? " action-row--disabled" : ""}"><button class="action-modal-btn action-modal-btn--with-thumb${disabledClass}" data-action-index="${i}">${labelHtml}</button>${thumbHtml}</div>`;
        }
        return `<button class="action-modal-btn${disabledClass}" data-action-index="${i}">${labelHtml}</button>`;
      })
      .join("");
  }

  // Cylon phase status summary
  let cylonSummaryHtml = "";
  const isFleetJump = state.choiceType === "fleet-jump-sacrifice";
  if (state.phase === "cylon" && (state.cylonThreats.length > 0 || isFleetJump)) {
    const threatLevel = computeThreatLevel(state);
    const threatList = state.cylonThreats
      .map(
        (t) =>
          `<span class="cylon-summary-threat">${escapeHtml(getCardName(t.card.defId))} (${t.power})</span>`,
      )
      .join(", ");
    if (isFleetJump) {
      cylonSummaryHtml = `
        <div class="cylon-status-summary" style="border-color:#c9a227;background:rgba(201,162,39,0.08);">
          <div class="cylon-summary-line" style="color:#e8d44d;">⚡ <strong>Fleet Jump!</strong> All threats are Cylon — the fleet jumps away.</div>
          <div class="cylon-summary-line">${state.cylonThreats.length > 0 ? `Threats: ${threatList}` : "Threats cleared."}</div>
          <div class="cylon-summary-hint">Each player must sacrifice an asset or supply card.</div>
        </div>
      `;
    } else {
      cylonSummaryHtml = `
        <div class="cylon-status-summary">
          <div class="cylon-summary-line">Threat ${threatLevel} vs Fleet Defense ${state.fleetDefenseLevel + (state.fleetDefenseModifier ?? 0)} — <strong>Cylons broke through!</strong></div>
          <div class="cylon-summary-line">${state.cylonThreats.length} threat${state.cylonThreats.length > 1 ? "s" : ""} active: ${threatList}</div>
          <div class="cylon-summary-hint">Defeat threats with your units, or stand down and lose 1 influence.</div>
        </div>
      `;
    }
  }

  const challengeSummaryHtml = state.challenge ? buildChallengeSummaryHtml() : "";

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-drag-handle" style="cursor:grab;user-select:none;padding:8px 1rem;background:#222;border-bottom:1px solid #444;border-radius:8px 8px 0 0;color:#e0e0e0;font-size:0.9rem;">
        ${headerText}
      </div>
      <div class="action-modal-top">
        ${challengeSummaryHtml}
        ${cylonSummaryHtml}
        <div class="player-action-buttons">${buttonsHtml}</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  attachModalDragBehavior(overlay);

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

  // Wire inline card name links → card preview
  overlay.querySelectorAll(".notif-card-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (link as HTMLElement).dataset.defId;
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
      const labelHtml = badgeHtml
        ? `<span class="action-btn-label">${escapeHtml(b.label)}</span>${badgeHtml}`
        : escapeHtml(b.label);
      const btnHtml = `<button class="${btnClass}" data-btn-index="${i}">${labelHtml}</button>`;
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
      <div class="action-modal-drag-handle" style="cursor:grab;user-select:none;padding:8px 1rem;background:#222;border-bottom:1px solid #444;border-radius:8px 8px 0 0;color:#e0e0e0;font-size:0.9rem;">
        ${escapeHtml(prompt)}
      </div>
      <div class="action-modal-top">
        <div class="player-action-buttons">${buttonsHtml}</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  attachModalDragBehavior(overlay);

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

/** Selection modal: shows selectable rows with thumbnails, optional grouping, and a confirm button.
 *  Used by enterSelectMode / enterSelectModeInstance instead of highlighting cards on the board. */
function showSelectModal(
  prompt: string,
  items: {
    label: string;
    onClick: () => void;
    cancel?: boolean;
    cardDefId?: string;
    selectValue?: string;
    selectGroup?: string;
  }[],
  onConfirm: (selectedValue: string) => void,
): void {
  dismissPlayerActionModal();

  let selectedValue: string | null = null;

  // Separate selectable items from action buttons (like Cancel)
  const selectables = items.filter((b) => b.selectValue != null);
  const actions = items.filter((b) => b.selectValue == null);

  // Group selectable items by selectGroup
  const groups = new Map<string, typeof selectables>();
  for (const item of selectables) {
    const g = item.selectGroup ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  // Build selectable rows HTML
  let rowsHtml = "";
  for (const [groupLabel, groupItems] of groups) {
    if (groupLabel) {
      rowsHtml += `<div class="select-group-label">${escapeHtml(groupLabel)}</div>`;
    }
    for (const item of groupItems) {
      const card = item.cardDefId ? cardDefs[item.cardDefId] : null;
      const base = item.cardDefId ? baseDefs[item.cardDefId] : null;
      const image = card?.image ?? base?.image;
      const isBase = !!base;
      const thumbHtml = image
        ? `<img src="${image}" alt="" class="select-row-thumb${isBase ? " card-clip-landscape" : ""}" data-def-id="${item.cardDefId}" />`
        : "";
      rowsHtml += `<div class="select-row" data-select-value="${escapeHtml(item.selectValue!)}">${thumbHtml}<span class="select-row-label">${escapeHtml(item.label)}</span><span class="select-row-radio"></span></div>`;
    }
  }

  // Build action buttons (Cancel etc)
  const actionsHtml = actions
    .map(
      (b, i) =>
        `<button class="action-modal-btn${b.cancel ? " cancel-modal-btn" : ""}" data-action-index="${i}">${escapeHtml(b.label)}</button>`,
    )
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-drag-handle" style="cursor:grab;user-select:none;padding:8px 1rem;background:#222;border-bottom:1px solid #444;border-radius:8px 8px 0 0;color:#e0e0e0;font-size:0.9rem;">
        ${escapeHtml(prompt)}
      </div>
      <div class="action-modal-top">
        <div class="select-rows-container">${rowsHtml}</div>
        <div class="player-action-buttons">
          <button class="action-modal-btn select-confirm-btn" disabled>Confirm</button>
          ${actionsHtml}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  attachModalDragBehavior(overlay);

  const confirmBtn = overlay.querySelector(".select-confirm-btn") as HTMLButtonElement;

  // Row selection
  overlay.querySelectorAll(".select-row").forEach((row) => {
    row.addEventListener("click", () => {
      const val = (row as HTMLElement).dataset.selectValue;
      if (!val) return;
      // Deselect previous
      overlay
        .querySelectorAll(".select-row--selected")
        .forEach((r) => r.classList.remove("select-row--selected"));
      row.classList.add("select-row--selected");
      selectedValue = val;
      confirmBtn.disabled = false;
    });
  });

  // Thumbnail clicks → full card preview (don't select row)
  overlay.querySelectorAll(".select-row-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const defId = (thumb as HTMLElement).dataset.defId;
      if (defId) showCardPreview(defId);
    });
  });

  // Confirm button
  confirmBtn.addEventListener("click", () => {
    if (selectedValue != null) {
      onConfirm(selectedValue);
    }
  });

  // Action buttons (Cancel etc)
  overlay.querySelectorAll("[data-action-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt((btn as HTMLElement).dataset.actionIndex ?? "-1");
      if (actions[idx]) actions[idx].onClick();
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

const PHASE_LABELS: Record<string, string> = {
  setup: "Setup",
  execution: "Execution",
  cylon: "Cylon",
  gameOver: "Game Over",
};

const READY_STEP_LABELS: Record<number, string> = {
  3: "Ready \u2014 Draw Cards",
  4: "Ready \u2014 Deploy Resource",
  5: "Ready \u2014 Reorder Stacks",
};

function formatPhase(phase: string, readyStep: number): string {
  if (phase === "ready") return READY_STEP_LABELS[readyStep] ?? `Ready (step ${readyStep})`;
  return PHASE_LABELS[phase] ?? phase;
}

function renderOpponentZones(
  opp: OpponentView,
  challenge: ChallengeState | null,
  traitGrants?: Record<string, Trait[]>,
  keywordGrants?: Record<string, string[]>,
  traitRemovals?: Record<string, Trait[]>,
  effectImmunity?: Record<string, "power" | "all">,
  passivePowerBuffs?: Record<string, number>,
): string {
  return `
    <div class="zone resource-zone">
      <div class="zone-label">Resource</div>
      <div class="zone-cards">
        ${opp.zones.resourceStacks.map((stack) => renderResourceStack(stack, false)).join("")}
        ${opp.zones.persistentMissions?.length ? `<div class="persistent-area"><div class="persistent-area-label">Persistent</div>${opp.zones.persistentMissions.map((mc) => renderPersistentMission(mc)).join("")}</div>` : ""}
      </div>
    </div>
    <div class="zone reserve-zone">
      <div class="zone-label">Reserve</div>
      <div class="zone-cards">
        ${opp.zones.reserve.map((stack) => renderUnitStack(stack, false, challenge, traitGrants, keywordGrants, traitRemovals, effectImmunity, passivePowerBuffs)).join("")}
        ${opp.zones.reserve.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone alert-zone">
      <div class="zone-label">Alert</div>
      <div class="zone-cards">
        ${opp.zones.alert.map((stack) => renderUnitStack(stack, false, challenge, traitGrants, keywordGrants, traitRemovals, effectImmunity, passivePowerBuffs)).join("")}
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
        ${state.you.zones.alert.map((stack) => renderUnitStack(stack, true, state.challenge, state.traitGrants, state.keywordGrants, state.traitRemovals, state.effectImmunity, state.passivePowerBuffs)).join("")}
        ${state.you.zones.alert.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone reserve-zone">
      <div class="zone-label">Reserve</div>
      <div class="zone-cards">
        ${state.you.zones.reserve.map((stack) => renderUnitStack(stack, true, state.challenge, state.traitGrants, state.keywordGrants, state.traitRemovals, state.effectImmunity, state.passivePowerBuffs)).join("")}
        ${state.you.zones.reserve.length === 0 ? '<div class="empty-zone">empty</div>' : ""}
      </div>
    </div>
    <div class="zone resource-zone">
      <div class="zone-label">Resource</div>
      <div class="zone-cards">
        ${state.you.zones.resourceStacks.map((stack, i) => renderResourceStack(stack, true, i)).join("")}
        ${state.you.zones.persistentMissions?.length ? `<div class="persistent-area"><div class="persistent-area-label">Persistent</div>${state.you.zones.persistentMissions.map((mc) => renderPersistentMission(mc)).join("")}</div>` : ""}
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
      ${image ? `<img src="${image}" alt="${name}" class="resource-card-img" />` : `<div class="card-text-fallback mission"><div class="card-name">${name}</div><div class="card-type">Persistent</div></div>`}
    </div>
  `;
}

function buildResourceSummaryHtml(stacks: ResourceStack[]): string {
  const badges = stacks
    .map((stack) => {
      const res = getResourceName(stack.topCard.defId);
      if (!res) return "";
      const value = 1 + stack.supplyCards.length;
      const letter = res.charAt(0).toUpperCase();
      const dimClass = stack.exhausted ? " header-res-badge--empty" : "";
      return `<span class="header-res-badge header-res-badge--${res}${dimClass}">${value}${letter}</span>`;
    })
    .join("");
  return badges ? `<span class="header-res-badges">${badges}</span>` : "";
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

function renderUnitStack(
  stack: UnitStack,
  isYours: boolean,
  challenge: ChallengeState | null = null,
  traitGrants?: Record<string, Trait[]>,
  keywordGrants?: Record<string, string[]>,
  traitRemovals?: Record<string, Trait[]>,
  effectImmunity?: Record<string, "power" | "all">,
  passivePowerBuffs?: Record<string, number>,
): string {
  const topCard = stack.cards[0];
  if (!topCard) return "";
  const def = getCardDef(topCard.defId);
  const name = def ? getCardName(topCard.defId) : topCard.defId;
  const basePower = def?.power ?? 0;
  const stackBuff = stack.powerBuff ?? 0;
  const passiveBuff = passivePowerBuffs?.[topCard.instanceId] ?? 0;
  // Include temporary challenge power buff if this unit is the challenger or defender
  let challengeBuff = 0;
  if (challenge && topCard.instanceId === challenge.challengerInstanceId) {
    challengeBuff = challenge.challengerPowerBuff ?? 0;
  } else if (challenge && topCard.instanceId === challenge.defenderInstanceId) {
    challengeBuff = challenge.defenderPowerBuff ?? 0;
  }
  const buff = stackBuff + passiveBuff + challengeBuff;
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
  const linkedMissions = stack.linkedMissions ?? [];
  const linkedBadge =
    linkedMissions.length > 0
      ? `<div class="linked-mission-badge" data-linked-def-ids="${linkedMissions.map((m) => m.defId).join(",")}" title="${linkedMissions.map((m) => getCardName(m.defId)).join(", ")}">${linkedMissions.length}LM</div>`
      : "";
  const granted = traitGrants?.[topCard.instanceId];
  const traitBadge = granted?.length
    ? `<div class="trait-grant-badge" title="${granted.join(", ")}">${granted.join(", ")}</div>`
    : "";
  const removed = traitRemovals?.[topCard.instanceId];
  const traitRemovalBadge = removed?.length
    ? `<div class="trait-removal-badge" title="Lost: ${removed.join(", ")}">-${removed.join(", ")}</div>`
    : "";
  const grantedKw = keywordGrants?.[topCard.instanceId];
  const keywordBadge = grantedKw?.length
    ? `<div class="keyword-grant-badge" title="${grantedKw.join(", ")}">${grantedKw.join(", ")}</div>`
    : "";
  const immunity = effectImmunity?.[topCard.instanceId];
  const immunityBadge = immunity
    ? `<div class="immunity-badge" title="${immunity === "all" ? "Immune to all effects" : "Immune to power changes"}">${immunity === "all" ? "IMMUNE" : "PWR IMMUNE"}</div>`
    : "";

  if (image) {
    const displayImage = stack.exhausted ? "images/cards/bsgbetback-portrait.jpg" : image;
    const displayAlt = stack.exhausted ? "Exhausted" : escapeHtml(name);
    return `
      <div class="unit-card-img ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
        <img src="${displayImage}" alt="${displayAlt}" class="unit-card-thumb" loading="lazy" />
        ${typeClass !== "mission" ? `<div class="unit-power-badge${buffClass}"><span class="unit-power-badge-inner">${totalPower}</span></div>` : ""}
        ${stackSize > 1 ? `<div class="unit-stack-badge">x${stackSize}</div>` : ""}
        ${linkedBadge}
        ${traitBadge}
        ${traitRemovalBadge}
        ${keywordBadge}
        ${immunityBadge}
      </div>
    `;
  }

  if (stack.exhausted) {
    return `
      <div class="unit-card-img ${exhaustedClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
        <img src="images/cards/bsgbetback-portrait.jpg" alt="Exhausted" class="unit-card-thumb" loading="lazy" />
        ${typeClass !== "mission" ? `<div class="unit-power-badge${buffClass}"><span class="unit-power-badge-inner">${totalPower}</span></div>` : ""}
        ${stackSize > 1 ? `<div class="unit-stack-badge">x${stackSize}</div>` : ""}
        ${linkedBadge}
        ${traitBadge}
        ${traitRemovalBadge}
        ${keywordBadge}
        ${immunityBadge}
      </div>
    `;
  }

  const cylonThreat = getCardCylonThreat(topCard.defId);
  return `
    <div class="card unit-card ${typeClass}" data-instance-id="${topCard.instanceId}" data-def-id="${topCard.defId}">
      <div class="card-name">${escapeHtml(name)}</div>
      <div class="card-stats">
        ${typeClass !== "mission" ? `<span class="card-power${buffClass}">${powerDisplay}</span>` : ""}
        ${cylonThreat > 0 ? `<span class="card-threat">${cylonThreat}</span>` : ""}
      </div>
      ${stackSize > 1 ? `<div class="card-stack-count">x${stackSize}</div>` : ""}
      ${linkedBadge}
      ${traitBadge}
      ${traitRemovalBadge}
      ${keywordBadge}
      ${immunityBadge}
    </div>
  `;
}

function renderHandCard(card: CardInstance, index: number, validActions: ValidAction[]): string {
  const def = cardDefs[card.defId];
  if (!def) return "";

  const name = getCardName(card.defId);

  // Check if this card index is in any non-disabled valid action
  const playable = validActions.some(
    (a) => !a.disabled && a.selectableCardIndices?.includes(index),
  );

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
          .map((t, i) => {
            const def = cardDefs[t.card.defId];
            const name = getCardName(t.card.defId);
            const redText = def?.cylonThreatText ?? "";
            const image = def?.image;
            return `
          <div class="threat-card" data-threat-index="${i}" data-def-id="${t.card.defId}">
            ${image ? `<img src="${image}" alt="${escapeHtml(name)}" class="threat-card-img" loading="lazy" />` : ""}
            <div class="threat-card-info">
              <div class="card-name">${escapeHtml(name)}</div>
              ${redText ? `<div class="threat-red-text">${escapeHtml(redText)}</div>` : ""}
              <div class="threat-power">${t.power}</div>
            </div>
          </div>
        `;
          })
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

function applyBoardZoom(boards: HTMLElement | null): void {
  if (!boards) return;
  if (boardZoomPercent === 0) {
    (boards.style as any).zoom = "";
  } else {
    (boards.style as any).zoom = `${1 + boardZoomPercent / 100}`;
  }
}

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

  // Unit card image tap-to-preview (with runtime modifiers)
  container.querySelectorAll(".unit-card-img[data-def-id]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selectable")) return;
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defId;
      if (!defId) return;
      const instanceId = htmlEl.dataset.instanceId;
      const runtime = instanceId ? buildRuntimeInfo(instanceId, state) : undefined;
      showCardPreview(defId, { runtime });
    });
  });

  // Linked mission badge tap-to-preview
  container.querySelectorAll(".linked-mission-badge[data-linked-def-ids]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ids = (el as HTMLElement).dataset.linkedDefIds?.split(",") ?? [];
      if (ids.length === 1) {
        showCardPreview(ids[0]);
      } else if (ids.length > 1) {
        showCardPreviewNav(ids, 0);
      }
    });
  });

  // Cylon threat card tap-to-preview
  container.querySelectorAll(".threat-card[data-def-id]").forEach((el) => {
    el.addEventListener("click", () => {
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

  // Zoom controls (desktop only)
  const boards = container.querySelector(".boards") as HTMLElement | null;
  container.querySelector("#zoom-in")?.addEventListener("click", () => {
    if (boardZoomPercent < ZOOM_MAX) {
      boardZoomPercent = Math.min(ZOOM_MAX, boardZoomPercent + ZOOM_STEP);
      localStorage.setItem("boardZoomPercent", String(boardZoomPercent));
      applyBoardZoom(boards);
      const label = container.querySelector("#zoom-label");
      if (label) label.textContent = boardZoomPercent + "%";
    }
  });
  container.querySelector("#zoom-out")?.addEventListener("click", () => {
    if (boardZoomPercent > ZOOM_MIN) {
      boardZoomPercent = Math.max(ZOOM_MIN, boardZoomPercent - ZOOM_STEP);
      localStorage.setItem("boardZoomPercent", String(boardZoomPercent));
      applyBoardZoom(boards);
      const label = container.querySelector("#zoom-label");
      if (label) label.textContent = boardZoomPercent + "%";
    }
  });
  applyBoardZoom(boards);

  // Track scroll position continuously so it survives modal open/close cycles
  if (boards) {
    boards.addEventListener("scroll", () => {
      savedBoardScrollTop = boards.scrollTop;
    });
  }

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
      const card = state.you.hand[cardIdx];
      const def = card ? cardDefs[card.defId] : null;
      const targets = action.selectableInstanceIds;
      const cost = def?.cost ?? null;
      const needsStackPicker = cost && hasResourceChoice(cost, state.you.zones.resourceStacks);

      if (needsStackPicker && targets && targets.length > 0) {
        // Both stack selection AND target selection needed — stack picker first
        showResourceStackPicker(cardIdx, cost, state, validActions, container, (stackIndices) => {
          const cardLabel = def ? getCardName(card.defId) : "event";
          enterSelectModeInstance(
            container,
            action.targetPrompt ?? `Select target for ${cardLabel}`,
            targets,
            (targetId) => {
              onAction!({
                type: "playCard",
                cardIndex: cardIdx,
                targetInstanceId: targetId,
                selectedStackIndices: stackIndices,
              });
            },
            validActions,
            state,
          );
        });
      } else if (needsStackPicker) {
        // Only stack selection needed
        showResourceStackPicker(cardIdx, cost, state, validActions, container, (stackIndices) => {
          onAction!({ type: "playCard", cardIndex: cardIdx, selectedStackIndices: stackIndices });
        });
      } else if (targets && targets.length > 0) {
        // Only target selection (no meaningful stack choice)
        const cardLabel = def ? getCardName(card.defId) : "event";
        enterSelectModeInstance(
          container,
          action.targetPrompt ?? `Select target for ${cardLabel}`,
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

      // Multi-card selection via select modal
      enterSelectMode(
        container,
        "Select a card to deploy as a resource",
        indices,
        (idx) => {
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
        },
        validActions,
        state,
      );
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

    case "sniperAccept": {
      onAction({ type: "sniperAccept", accept: !!action.accept });
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
      const missionId = missions[0];
      const mTargets = (action as any).missionTargetIds as string[] | undefined;
      const lTargets = (action as any).linkTargetIds as string[] | undefined;

      // Helper to send the final action with all selected targets
      const sendResolve = (resolveTarget?: string, linkTarget?: string) => {
        onAction!({
          type: "resolveMission",
          missionInstanceId: missionId,
          unitInstanceIds: [],
          targetInstanceId: resolveTarget,
          linkTargetInstanceId: linkTarget,
        } as any);
      };

      // Helper to handle link target selection (or skip if not needed)
      const handleLinkStep = (resolveTarget?: string) => {
        if (lTargets && lTargets.length > 0) {
          enterSelectModeInstance(
            container,
            "Select unit to attach mission to",
            lTargets,
            (linkId) => sendResolve(resolveTarget, linkId),
            validActions,
            state,
          );
        } else {
          sendResolve(resolveTarget);
        }
      };

      if (mTargets && mTargets.length > 0) {
        // Step 1: select resolve target, then optionally link target
        enterSelectModeInstance(
          container,
          `Select target for ${action.description.split(":")[0]}`,
          mTargets,
          (targetId) => handleLinkStep(targetId),
          validActions,
          state,
        );
      } else {
        // No resolve target needed — possibly just link target
        handleLinkStep();
      }
      break;
    }

    case "playAbility": {
      // sourceInstanceId is pre-set: unit abilities with targets, linked missions
      if (action.sourceInstanceId) {
        const targets = action.selectableInstanceIds ?? [];
        if (targets.length > 0) {
          const abilityIdx = action.abilityIndex;
          enterSelectModeInstance(
            container,
            action.targetPrompt ?? "Select target for ability",
            targets,
            (targetId) => {
              onAction!({
                type: "playAbility",
                sourceInstanceId: action.sourceInstanceId!,
                targetInstanceId: targetId,
                abilityIndex: abilityIdx,
              });
            },
            validActions,
            state,
          );
        } else {
          onAction({
            type: "playAbility",
            sourceInstanceId: action.sourceInstanceId,
            abilityIndex: action.abilityIndex,
          });
        }
        break;
      }

      const sources = action.selectableInstanceIds ?? [];
      if (sources.length === 1) {
        // Player target picker (e.g. base abilities targeting a player)
        if (action.selectablePlayerIndices && action.selectablePlayerIndices.length > 0) {
          const items = action.selectablePlayerIndices.map((idx: number) => ({
            label: idx === state.you.playerIndex ? "Yourself" : state.playerNames[idx as 0 | 1],
            selectValue: `player-${idx}`,
            onClick: () => {},
          }));
          items.push({
            label: "Cancel",
            onClick: () => dismissPlayerActionModal(),
            cancel: true,
          } as (typeof items)[0]);
          showSelectModal(action.description, items, (selectedValue) => {
            onAction!({
              type: "playAbility",
              sourceInstanceId: sources[0],
              targetInstanceId: selectedValue,
            });
          });
          break;
        }
        // If the server already provided a target, use it directly
        if (action.targetInstanceId) {
          onAction({
            type: "playAbility",
            sourceInstanceId: sources[0],
            targetInstanceId: action.targetInstanceId,
          });
        } else {
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

      /** Send challenge event action, with optional stack picker first. */
      const sendChallengeEvent = (cardIdx: number, eventTargets?: string[]): void => {
        const evCard = state.you.hand[cardIdx];
        const evDef = evCard ? cardDefs[evCard.defId] : null;
        const evCost = evDef?.cost ?? null;
        const needsPicker = evCost && hasResourceChoice(evCost, state.you.zones.resourceStacks);

        const sendWithStacks = (stackIndices?: number[]): void => {
          if (eventTargets && eventTargets.length > 0) {
            const cardLabel = evCard ? getCardName(evCard.defId) : "event";
            enterSelectModeInstance(
              container,
              action.targetPrompt ?? `Select target for ${cardLabel}`,
              eventTargets,
              (targetId) => {
                onAction!({
                  type: "playEventInChallenge",
                  cardIndex: cardIdx,
                  targetInstanceId: targetId,
                  ...(stackIndices ? { selectedStackIndices: stackIndices } : {}),
                });
              },
              validActions,
              state,
            );
          } else {
            onAction!({
              type: "playEventInChallenge",
              cardIndex: cardIdx,
              ...(stackIndices ? { selectedStackIndices: stackIndices } : {}),
            });
          }
        };

        if (needsPicker) {
          showResourceStackPicker(cardIdx, evCost, state, validActions, container, sendWithStacks);
        } else {
          sendWithStacks();
        }
      };

      if (indices.length === 1) {
        sendChallengeEvent(indices[0], targets && targets.length > 0 ? targets : undefined);
      } else {
        // Multiple events selectable — pick card first
        enterSelectMode(
          container,
          "Select event to play",
          indices,
          (idx) => {
            const matchingAction = validActions.find(
              (a) =>
                a.type === "playEventInChallenge" &&
                a.selectableCardIndices?.includes(idx as number),
            );
            const eventTargets = matchingAction?.selectableInstanceIds;
            sendChallengeEvent(
              idx as number,
              eventTargets && eventTargets.length > 0 ? eventTargets : undefined,
            );
          },
          validActions,
          state,
        );
      }
      break;
    }

    case "challengeCylon": {
      const units = action.selectableInstanceIds ?? [];
      const threats = action.selectableThreatIndices ?? [];
      const threatIdx = threats[0] ?? 0;

      const selectItems: {
        label: string;
        onClick: () => void;
        cancel?: boolean;
        cardDefId?: string;
        selectValue?: string;
      }[] = units.map((unitId) => {
        const stack = findUnitStack(state.you.zones, unitId);
        const defId = stack?.cards[0]?.defId ?? "";
        const name = defId ? getCardName(defId) : unitId;
        const power = stack
          ? (getCardDef(defId)?.power ?? 0) +
            (stack.powerBuff ?? 0) +
            (state.passivePowerBuffs?.[unitId] ?? 0)
          : 0;
        return {
          label: `${name} (${power})`,
          cardDefId: defId,
          selectValue: unitId,
          onClick: () => {},
        };
      });

      selectItems.push({
        label: "Cancel",
        cancel: true,
        onClick: () => {
          restoreActionsBar(container, validActions, state);
        },
      });

      showSelectModal("Select unit to challenge Cylon threat", selectItems, (unitId) => {
        onAction!({
          type: "challengeCylon",
          challengerInstanceId: unitId,
          threatIndex: threatIdx,
        });
      });
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
      onAction({
        type: "strafeChoice",
        challengeAs:
          action.challengeAs ?? (action.description.includes("personnel") ? "personnel" : "ship"),
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
  // Build selectable rows for hand cards
  const buttons: {
    label: string;
    onClick: () => void;
    cancel?: boolean;
    cardDefId?: string;
    selectValue?: string;
    selectGroup?: string;
  }[] = [];

  if (state) {
    for (const idx of selectableIndices) {
      const card = state.you.hand[idx];
      if (!card) continue;
      const name = getCardName(card.defId);
      buttons.push({
        label: name,
        cardDefId: card.defId,
        selectValue: String(idx),
        onClick: () => {},
      });
    }
  }

  buttons.push({
    label: "Cancel",
    cancel: true,
    onClick: () => {
      if (validActions && state) {
        restoreActionsBar(container, validActions, state);
      }
    },
  });

  showSelectModal(prompt, buttons, (value) => {
    callback(parseInt(value));
  });
}

function enterSelectModeInstance(
  container: HTMLElement,
  prompt: string,
  selectableIds: string[],
  callback: (id: string) => void,
  validActions?: ValidAction[],
  state?: PlayerGameView,
): void {
  // Build selectable rows from instance IDs, grouped by owner
  const buttons: {
    label: string;
    onClick: () => void;
    cancel?: boolean;
    cardDefId?: string;
    selectValue?: string;
    selectGroup?: string;
  }[] = [];

  // Resolve each selectable instance to card info + owner
  const yourIds = new Set<string>();
  const oppIds = new Set<string>();

  if (state) {
    const collectIds = (zones: PlayerZones, target: Set<string>) => {
      for (const stack of [...zones.alert, ...zones.reserve]) {
        for (const card of stack.cards) target.add(card.instanceId);
        if (stack.linkedMissions) {
          for (const m of stack.linkedMissions) target.add(m.instanceId);
        }
      }
      if (zones.persistentMissions) {
        for (const m of zones.persistentMissions) target.add(m.instanceId);
      }
    };
    collectIds(state.you.zones, yourIds);
    collectIds(state.opponent.zones, oppIds);
  }

  const hasAnyOwner =
    selectableIds.some((id) => yourIds.has(id)) || selectableIds.some((id) => oppIds.has(id));

  for (const instId of selectableIds) {
    // Find card def from either player's zones
    let defId = "";
    let isYours: boolean | null = null;
    if (state) {
      // Check resource stack synthetic IDs (rstack-playerIdx-stackIdx)
      const rstackMatch = instId.match(/^rstack-(\d+)-(\d+)$/);
      if (rstackMatch) {
        const pIdx = parseInt(rstackMatch[1], 10);
        const sIdx = parseInt(rstackMatch[2], 10);
        const zones = pIdx === state.you.playerIndex ? state.you.zones : state.opponent.zones;
        const rstack = zones.resourceStacks[sIdx];
        if (rstack) {
          defId = rstack.topCard.defId;
        }
        isYours = pIdx === state.you.playerIndex;
      } else {
        const stack =
          findUnitStack(state.you.zones, instId) ?? findUnitStack(state.opponent.zones, instId);
        if (stack) {
          defId = stack.cards[0]?.defId ?? "";
        } else {
          // Check discard piles
          const discardCard =
            state.you.discard.find((c) => c.instanceId === instId) ??
            state.opponent.discard.find((c) => c.instanceId === instId);
          if (discardCard) {
            defId = discardCard.defId;
          } else {
            // Check linked missions and persistent missions
            const findLinked = (zones: PlayerZones): string => {
              for (const s of [...zones.alert, ...zones.reserve]) {
                const linked = s.linkedMissions?.find((m) => m.instanceId === instId);
                if (linked) return linked.defId;
              }
              const pm = zones.persistentMissions?.find((m) => m.instanceId === instId);
              if (pm) return pm.defId;
              return "";
            };
            defId = findLinked(state.you.zones) || findLinked(state.opponent.zones);
          }
        }
      }
    }

    const name = defId ? getCardName(defId) : instId;
    let group = "";
    if (isYours !== null) {
      group = isYours ? "Your cards" : "Opponent cards";
    } else if (hasAnyOwner) {
      group = yourIds.has(instId) ? "Your cards" : "Opponent cards";
    }

    buttons.push({
      label: name,
      cardDefId: defId || undefined,
      selectValue: instId,
      selectGroup: group,
      onClick: () => {},
    });
  }

  buttons.push({
    label: "Cancel",
    cancel: true,
    onClick: () => {
      if (validActions && state) {
        restoreActionsBar(container, validActions, state);
      }
    },
  });

  showSelectModal(prompt, buttons, (value) => {
    callback(value);
  });
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
      label: stackName,
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

/** Check if there's a resource cost that requires stack selection. */
function hasResourceChoice(
  cost: { persuasion?: number; logistics?: number; security?: number } | null,
  _stacks: ResourceStack[],
): boolean {
  if (!cost) return false;
  // Always let the player pick which stacks to spend
  return Object.values(cost).some((amount) => amount > 0);
}

/** Compute the optimal stack selection (minimize waste) for a given cost. */
/** Interactive resource stack picker modal for choosing which stacks to spend. */
function showResourceStackPicker(
  cardIndex: number,
  cost: { persuasion?: number; logistics?: number; security?: number },
  state: PlayerGameView,
  validActions: ValidAction[],
  container: HTMLElement,
  onConfirm: (selectedStackIndices: number[]) => void,
): void {
  dismissPlayerActionModal();

  const card = state.you.hand[cardIndex];
  const cardDefId = card?.defId ?? "";
  const cardLabel = card ? getCardName(card.defId) : "card";
  const cardImage = cardDefs[cardDefId]?.image ?? baseDefs[cardDefId]?.image ?? "";

  // Start with nothing selected — user manually picks stacks
  const selectedSet = new Set<number>();

  // Group stacks by resource type (only types present in the cost)
  const costTypes = Object.entries(cost).filter(([, amt]) => amt > 0) as [string, number][];

  type StackInfo = {
    index: number;
    name: string;
    count: number;
    defId: string;
    image: string;
    isBase: boolean;
    disabled: boolean;
  };
  const stacksByType: Record<string, StackInfo[]> = {};

  for (const [resType] of costTypes) {
    const matching: StackInfo[] = [];
    const nonMatching: StackInfo[] = [];
    state.you.zones.resourceStacks.forEach((stack, i) => {
      if (stack.exhausted) return;
      const def = cardDefs[stack.topCard.defId] ?? baseDefs[stack.topCard.defId];
      const name = def?.title ?? stack.topCard.defId;
      const isBase = !!baseDefs[stack.topCard.defId];
      const info: StackInfo = {
        index: i,
        name,
        count: 1 + stack.supplyCards.length,
        defId: stack.topCard.defId,
        image: (cardDefs[stack.topCard.defId]?.image ?? baseDefs[stack.topCard.defId]?.image) || "",
        isBase,
        disabled: getResourceName(stack.topCard.defId) !== resType,
      };
      if (info.disabled) nonMatching.push(info);
      else matching.push(info);
    });
    stacksByType[resType] = [...matching, ...nonMatching];
  }

  // Build HTML
  const cardHeaderHtml = `
    <div class="resource-picker-card-header">
      ${cardImage ? `<img src="${cardImage}" alt="" class="resource-picker-card-thumb" data-def-id="${cardDefId}" style="cursor:pointer" />` : ""}
      <div class="resource-picker-card-info">
        <div class="resource-picker-card-name">${escapeHtml(cardLabel)}</div>
        <div class="resource-picker-card-cost">Cost: ${costBadgeHtml(cost)}</div>
      </div>
    </div>
  `;

  let sectionsHtml = "";
  for (const [resType, amount] of costTypes) {
    const stacks = stacksByType[resType] ?? [];
    const resLabel = resType.charAt(0).toUpperCase() + resType.slice(1);

    let rowsHtml = "";
    for (const s of stacks) {
      const sel = selectedSet.has(s.index) ? " resource-picker-row--selected" : "";
      const disabledCls = s.disabled ? " resource-picker-row--disabled" : "";
      const thumbClass = s.isBase
        ? "resource-picker-row-thumb card-clip-landscape"
        : "resource-picker-row-thumb";
      const thumbHtml = s.image
        ? `<img src="${s.image}" alt="" class="${thumbClass}" loading="lazy" data-def-id="${s.defId}" />`
        : "";
      // Show the stack's actual resource type badge
      const stackResType = getResourceName(s.defId) || resType;
      const stackLetter = resourceIcon(stackResType);
      rowsHtml += `
        <div class="resource-picker-row${sel}${disabledCls}" data-stack-index="${s.index}" data-res-type="${resType}">
          ${thumbHtml}
          <span class="resource-picker-row-name">${escapeHtml(s.name)}</span>
          <span class="resource-inline-badge resource-inline-badge--${stackResType}">${s.count}${stackLetter}</span>
          ${s.disabled ? "" : `<span class="resource-picker-toggle"><span class="resource-picker-toggle-check">&#x2713;</span></span>`}
        </div>
      `;
    }

    sectionsHtml += `
      <div class="resource-picker-section" data-res-type="${resType}">
        <div class="resource-picker-type-header">
          <span>${resLabel} (need ${amount})</span>
          <span class="resource-picker-provided" data-provided-type="${resType}"></span>
        </div>
        ${rowsHtml}
      </div>
    `;
  }

  const overlay = document.createElement("div");
  overlay.className = "player-action-overlay";
  overlay.innerHTML = `
    <div class="action-modal">
      <div class="action-modal-drag-handle" style="cursor:grab;user-select:none;padding:8px 1rem;background:#222;border-bottom:1px solid #444;border-radius:8px 8px 0 0;color:#e0e0e0;font-size:0.9rem;">
        Spend resources
      </div>
      <div class="action-modal-top">
        ${cardHeaderHtml}
        ${sectionsHtml}
        <div class="resource-picker-summary" data-picker-summary></div>
        <div class="resource-picker-buttons">
          <button class="resource-picker-confirm" data-picker-confirm disabled>Confirm</button>
          <button class="action-modal-btn cancel-modal-btn" data-picker-cancel>Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".action-modal") as HTMLElement;
  const dragHandle = overlay.querySelector(".action-modal-drag-handle") as HTMLElement;
  const modalBody = overlay.querySelector(".action-modal-top") as HTMLElement;
  let dragged = false;

  /** Move modal, shrinking if dragged past bottom edge. */
  function pickerDragTo(newTop: number, newLeft: number) {
    const handleH = dragHandle.offsetHeight;
    const modalW = modal.offsetWidth;
    const maxTop = window.innerHeight - handleH;
    const maxLeft = window.innerWidth - modalW;
    const clampedTop = Math.max(0, Math.min(newTop, maxTop));
    const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
    modal.style.top = clampedTop + "px";
    modal.style.left = clampedLeft + "px";
    modal.style.transform = "none";
    modal.style.maxHeight = window.innerHeight - clampedTop + "px";
  }

  /** Toggle collapse: header stays put, body expands downward with maxHeight capped to screen. */
  function pickerToggleCollapse() {
    const hidden = modalBody.style.display === "none";
    modalBody.style.display = hidden ? "" : "none";
    if (hidden) {
      const top = modal.getBoundingClientRect().top;
      modal.style.maxHeight = window.innerHeight - top + "px";
    }
  }

  // Desktop: drag in any direction (mouse)
  dragHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragged = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = modal.getBoundingClientRect();
    const startTop = rect.top;
    const startLeft = rect.left;
    if (modal.style.transform !== "none") {
      modal.style.left = startLeft + "px";
      modal.style.transform = "none";
    }
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragged = true;
      if (dragged) pickerDragTo(startTop + dy, startLeft + dx);
    };
    const onMouseUp = () => {
      dragHandle.style.cursor = "grab";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (!dragged) {
        pickerToggleCollapse();
      }
    };
    dragHandle.style.cursor = "grabbing";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Mobile: vertical drag only (touch)
  dragHandle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    dragged = false;
    const startY = e.touches[0].clientY;
    const rect = modal.getBoundingClientRect();
    const startTop = rect.top;
    const startLeft = rect.left;
    const onTouchMove = (ev: TouchEvent) => {
      if (Math.abs(ev.touches[0].clientY - startY) > DRAG_THRESHOLD) dragged = true;
      if (dragged) pickerDragTo(startTop + (ev.touches[0].clientY - startY), startLeft);
    };
    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      if (!dragged) {
        pickerToggleCollapse();
      }
    };
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Thumbnail → card preview
  overlay
    .querySelectorAll(".resource-picker-row-thumb, .resource-picker-card-thumb")
    .forEach((thumb) => {
      thumb.addEventListener("click", (e) => {
        e.stopPropagation();
        const defId = (thumb as HTMLElement).dataset.defId;
        if (defId) showCardPreview(defId);
      });
    });

  const confirmBtn = overlay.querySelector("[data-picker-confirm]") as HTMLButtonElement;
  const cancelBtn = overlay.querySelector("[data-picker-cancel]") as HTMLElement;
  const summaryEl = overlay.querySelector("[data-picker-summary]") as HTMLElement;

  // Update summary and confirm state based on current selection
  function updatePicker(): void {
    const currentSelected = new Set(
      Array.from(overlay.querySelectorAll(".resource-picker-row--selected")).map((el) =>
        parseInt((el as HTMLElement).dataset.stackIndex ?? "-1"),
      ),
    );

    let allMet = true;
    let totalExcess = 0;
    const excessParts: string[] = [];

    for (const [resType, amount] of costTypes) {
      let provided = 0;
      for (const idx of currentSelected) {
        const stack = state.you.zones.resourceStacks[idx];
        if (!stack) continue;
        if (getResourceName(stack.topCard.defId) === resType) {
          provided += 1 + stack.supplyCards.length;
        }
      }
      const met = provided >= amount;
      if (!met) allMet = false;
      const excess = Math.max(0, provided - amount);
      totalExcess += excess;
      if (excess > 0) excessParts.push(`${excess}${resourceIcon(resType)}`);

      // Update per-type provided indicator
      const provEl = overlay.querySelector(`[data-provided-type="${resType}"]`);
      if (provEl) {
        provEl.textContent = `${provided}/${amount}`;
        provEl.className = `resource-picker-provided ${met ? "resource-picker-provided--met" : "resource-picker-provided--short"}`;
      }
    }

    // Summary
    if (allMet && totalExcess === 0) {
      summaryEl.innerHTML = `<span class="resource-picker-exact">Exact payment</span>`;
    } else if (allMet) {
      summaryEl.innerHTML = `<span class="resource-picker-excess">Excess: ${excessParts.join(" ")} wasted</span>`;
    } else {
      summaryEl.innerHTML = `<span class="resource-picker-provided--short">Insufficient resources selected</span>`;
    }

    confirmBtn.disabled = !allMet;
    confirmBtn.textContent = `Confirm (${currentSelected.size} stack${currentSelected.size !== 1 ? "s" : ""})`;
  }

  // Wire row clicks to toggle selection
  overlay.querySelectorAll(".resource-picker-row").forEach((row) => {
    row.addEventListener("click", () => {
      row.classList.toggle("resource-picker-row--selected");
      updatePicker();
    });
  });

  // Initial update
  updatePicker();

  // Confirm
  confirmBtn.addEventListener("click", () => {
    const indices = Array.from(overlay.querySelectorAll(".resource-picker-row--selected")).map(
      (el) => parseInt((el as HTMLElement).dataset.stackIndex ?? "-1"),
    );
    dismissPlayerActionModal();
    onConfirm(indices);
  });

  // Cancel
  cancelBtn.addEventListener("click", () => {
    dismissPlayerActionModal();
    restoreActionsBar(container, validActions, state);
  });
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
      label: stackName,
      cardDefId: stack.topCard.defId,
      badge: { resName, total: totalResource, letter: resLetter },
      onClick: () => {
        onAction!({ type: "playToResource", cardIndex, asSupply: true, targetStackIndex: si });
      },
    };
  });

  showPromptModal(`Supply ${name} to:`, [
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
