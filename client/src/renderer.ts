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
} from "@bsg/shared";
import { setPreviewRegistry, showCardPreview } from "./card-preview.js";

// ============================================================
// BSG CCG — Client Renderer
// Renders the 3-zone game board to the DOM.
// ============================================================

let cardDefs: Record<string, CardDef> = {};
let baseDefs: Record<string, BaseCardDef> = {};
let onAction: ((action: GameAction) => void) | null = null;
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

export function renderGame(
  container: HTMLElement,
  state: PlayerGameView,
  validActions: ValidAction[],
  log: string[],
): void {
  selectMode = null;
  const isYourTurn = state.activePlayerIndex === state.you.playerIndex;

  container.innerHTML = `
    <div class="game-board">
      <div class="info-bar">
        <div class="info-item">Turn ${state.turn}</div>
        <div class="info-item phase">${formatPhase(state.phase, state.readyStep)}</div>
        <div class="info-item ${isYourTurn ? "your-turn" : ""}">
          ${isYourTurn ? "YOUR TURN" : "Opponent's turn"}${state.phase === "ready" && state.readyStep === 4 ? " (lowest influence first)" : ""}
        </div>
        <div class="info-item">Fleet Defense: ${state.fleetDefenseLevel}</div>
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

      ${state.challenge ? renderChallengeInfo(state) : ""}

      <div class="actions-bar" id="actions-bar">
        ${renderActions(validActions, state)}
      </div>

      <div class="log-area" id="log-area">
        ${log.map((l) => `<div class="log-entry">${escapeHtml(l)}</div>`).join("")}
      </div>
    </div>
  `;

  // Attach event listeners
  attachEventListeners(container, validActions, state);
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
    const displayImage = stack.exhausted ? "images/cards/bsgbetback.jpg" : image;
    const displayAlt = stack.exhausted ? "Spent" : escapeHtml(name);
    return `
      <div class="resource-stack-wrap" data-stack-index="${stackIndex ?? ""}">
        ${supplyCards}
        <div class="resource-card-img ${isBase ? "base-card" : ""} ${exhaustedClass}" data-stack-index="${stackIndex ?? ""}" data-instance-id="${stack.topCard.instanceId}" data-def-id="${stack.topCard.defId}">
          <img src="${displayImage}" alt="${displayAlt}" class="resource-card-thumb${isBase && !stack.exhausted ? " card-clip-landscape" : ""}${isBase && stack.exhausted ? " card-back-landscape" : ""}" loading="lazy" />
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
          <img src="images/cards/bsgbetback.jpg" alt="Spent" class="resource-card-thumb" loading="lazy" />
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

function renderChallengeInfo(state: PlayerGameView): string {
  const c = state.challenge!;
  const isChallenger = c.challengerPlayerIndex === state.you.playerIndex;
  return `
    <div class="challenge-info">
      <div class="challenge-label">CHALLENGE</div>
      <div class="challenge-detail">
        ${isChallenger ? "You are the challenger" : "You are the defender"}
        ${c.waitingForDefender ? " — Choose a defender or decline" : ""}
        ${c.step === 2 ? " — Play effects or pass" : ""}
      </div>
    </div>
  `;
}

function renderActions(validActions: ValidAction[], state: PlayerGameView): string {
  if (validActions.length === 0) {
    return '<div class="no-actions">Waiting for opponent...</div>';
  }

  return validActions
    .map((a, i) => {
      const needsTarget =
        a.selectableInstanceIds && a.selectableInstanceIds.length > 0 && a.type === "challenge";
      const needsCardSelect =
        a.selectableCardIndices && a.selectableCardIndices.length > 0 && a.type === "playCard";

      return `<button class="action-btn" data-action-index="${i}">${escapeHtml(a.description)}</button>`;
    })
    .join("");
}

// ============================================================
// Event Listeners
// ============================================================

function attachEventListeners(
  container: HTMLElement,
  validActions: ValidAction[],
  state: PlayerGameView,
): void {
  // Action buttons
  container.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt((btn as HTMLElement).dataset.actionIndex ?? "-1");
      const action = validActions[idx];
      if (!action || !onAction) return;
      handleActionClick(action, validActions, state, container);
    });
  });

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

  // Hand card tap-to-preview (skip if card is in select mode)
  container.querySelectorAll(".hand-card").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selectable")) return;
      const idx = parseInt((el as HTMLElement).dataset.cardIndex ?? "-1");
      const card = state.you.hand[idx];
      if (card) showCardPreview(card.defId);
    });
  });

  // Scroll log to bottom
  const logArea = container.querySelector("#log-area");
  if (logArea) {
    logArea.scrollTop = logArea.scrollHeight;
  }
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
        );
      }
      break;
    }

    case "playToResource": {
      const indices = action.selectableCardIndices ?? [];
      const handCards = container.querySelectorAll(".hand-card");

      // Step 1: Highlight hand cards for selection
      handCards.forEach((el) => {
        const idx = parseInt((el as HTMLElement).dataset.cardIndex ?? "-1");
        if (indices.includes(idx)) {
          el.classList.add("selectable");
          el.addEventListener("click", function handler() {
            el.removeEventListener("click", handler);
            // Remove all hand highlights
            handCards.forEach((el2) => el2.classList.remove("selectable"));

            const card = state.you.hand[idx];
            if (!card) return;
            const def = cardDefs[card.defId];
            const hasResource = !!def?.resource;
            const stackIndices = action.selectableStackIndices ?? [];

            if (hasResource && stackIndices.length > 0) {
              // Card has resource — offer: new pile or under existing
              showResourceDeployChoice(container, idx, stackIndices, state, validActions);
            } else if (hasResource) {
              // Card has resource, no existing stacks — new pile only
              onAction!({ type: "playToResource", cardIndex: idx, asSupply: false });
            } else {
              // No resource — supply only
              if (stackIndices.length === 1) {
                onAction!({
                  type: "playToResource",
                  cardIndex: idx,
                  asSupply: true,
                  targetStackIndex: stackIndices[0],
                });
              } else if (stackIndices.length > 1) {
                promptStackSelection(container, idx, stackIndices, state, validActions);
              }
            }
          });
        }
      });

      // Show prompt in actions bar
      const actionsBar = container.querySelector("#actions-bar");
      if (actionsBar) {
        actionsBar.innerHTML = `
          <div class="select-prompt">Select a card to deploy as a resource</div>
          <button class="action-btn cancel-btn" id="cancel-select">Cancel</button>`;
        document.getElementById("cancel-select")?.addEventListener("click", () => {
          handCards.forEach((el) => el.classList.remove("selectable"));
          restoreActionsBar(container, validActions, state);
        });
      }
      break;
    }

    case "challenge": {
      const units = action.selectableInstanceIds ?? [];
      enterSelectModeInstance(container, "Select a unit to challenge with", units, (id) => {
        onAction!({
          type: "challenge",
          challengerInstanceId: id,
          opponentIndex: 1 - state.you.playerIndex,
        });
      });
      break;
    }

    case "defend": {
      if (action.description === "Decline to defend") {
        onAction({ type: "defend", defenderInstanceId: null });
      } else {
        const defenders = action.selectableInstanceIds ?? [];
        enterSelectModeInstance(container, "Select a defender", defenders, (id) => {
          onAction!({ type: "defend", defenderInstanceId: id });
        });
      }
      break;
    }

    case "resolveMission": {
      const missions = action.selectableInstanceIds ?? [];
      if (missions.length === 1) {
        onAction({ type: "resolveMission", missionInstanceId: missions[0], unitInstanceIds: [] });
      } else {
        enterSelectModeInstance(container, "Select a mission to resolve", missions, (id) => {
          onAction!({ type: "resolveMission", missionInstanceId: id, unitInstanceIds: [] });
        });
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
          );
        } else {
          onAction({ type: "playAbility", sourceInstanceId: sources[0] });
        }
      } else {
        enterSelectModeInstance(container, action.description, sources, (id) => {
          onAction!({ type: "playAbility", sourceInstanceId: id });
        });
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
            enterSelectModeInstance(container, "Select target", targetUnits, (targetId) => {
              onAction!({
                type: "playEventInChallenge",
                cardIndex: indices[0],
                targetInstanceId: targetId,
              });
            });
          } else {
            onAction({ type: "playEventInChallenge", cardIndex: indices[0] });
          }
        }
      } else {
        enterSelectMode(container, "Select event to play", indices, (idx) => {
          onAction!({ type: "playEventInChallenge", cardIndex: idx as number });
        });
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

  // Show prompt
  const actionsBar = container.querySelector("#actions-bar");
  if (actionsBar) {
    actionsBar.innerHTML = `<div class="select-prompt">${escapeHtml(prompt)} — click a highlighted card</div>
      <button class="action-btn cancel-btn" id="cancel-select">Cancel</button>`;
    document.getElementById("cancel-select")?.addEventListener("click", () => {
      handCards.forEach((el) => el.classList.remove("selectable"));
    });
  }
}

function enterSelectModeInstance(
  container: HTMLElement,
  prompt: string,
  selectableIds: string[],
  callback: (id: string) => void,
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

  const actionsBar = container.querySelector("#actions-bar");
  if (actionsBar) {
    actionsBar.innerHTML = `<div class="select-prompt">${escapeHtml(prompt)} — click a highlighted card</div>
      <button class="action-btn cancel-btn" id="cancel-select">Cancel</button>`;
    document.getElementById("cancel-select")?.addEventListener("click", () => {
      allCards.forEach((el) => el.classList.remove("selectable"));
    });
  }
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

  const actionsBar = container.querySelector("#actions-bar");
  if (!actionsBar) return;

  actionsBar.innerHTML = `
    <div class="select-prompt">Deploy ${escapeHtml(cardName)}:</div>
    <button class="action-btn" id="deploy-new-pile">Start new resource pile</button>
    <button class="action-btn" id="deploy-under-existing">Place under existing resource</button>
    <button class="action-btn cancel-btn" id="cancel-deploy">Cancel</button>`;

  document.getElementById("deploy-new-pile")?.addEventListener("click", () => {
    onAction!({ type: "playToResource", cardIndex, asSupply: false });
  });

  document.getElementById("deploy-under-existing")?.addEventListener("click", () => {
    if (stackIndices.length === 1) {
      onAction!({
        type: "playToResource",
        cardIndex,
        asSupply: true,
        targetStackIndex: stackIndices[0],
      });
    } else {
      promptStackSelection(container, cardIndex, stackIndices, state, validActions);
    }
  });

  document.getElementById("cancel-deploy")?.addEventListener("click", () => {
    restoreActionsBar(container, validActions, state);
  });
}

function promptStackSelection(
  container: HTMLElement,
  cardIndex: number,
  stackIndices: number[],
  state: PlayerGameView,
  validActions: ValidAction[],
): void {
  const actionsBar = container.querySelector("#actions-bar");
  if (actionsBar) {
    actionsBar.innerHTML = `
      <div class="select-prompt">Select a resource stack to place under</div>
      <button class="action-btn cancel-btn" id="cancel-stack-select">Cancel</button>`;
    document.getElementById("cancel-stack-select")?.addEventListener("click", () => {
      container
        .querySelectorAll(".resource-card-img, .card.resource-card")
        .forEach((el) => el.classList.remove("selectable"));
      restoreActionsBar(container, validActions, state);
    });
  }

  // Highlight selectable resource stacks (target the wrapper or top-level stack element)
  container
    .querySelectorAll(
      ".your-board .resource-stack-wrap[data-stack-index], .your-board .resource-card-img[data-stack-index], .your-board .card.resource-card[data-stack-index]",
    )
    .forEach((el) => {
      // Skip inner elements if the wrap is already handling this stack
      if (
        !el.classList.contains("resource-stack-wrap") &&
        el.parentElement?.classList.contains("resource-stack-wrap")
      )
        return;
      const idx = parseInt((el as HTMLElement).dataset.stackIndex ?? "-1");
      if (stackIndices.includes(idx)) {
        el.classList.add("selectable");
        el.addEventListener("click", function handler() {
          el.removeEventListener("click", handler);
          onAction!({ type: "playToResource", cardIndex, asSupply: true, targetStackIndex: idx });
        });
      }
    });
}

function restoreActionsBar(
  container: HTMLElement,
  validActions: ValidAction[],
  state: PlayerGameView,
): void {
  // Remove all selectable highlights
  container.querySelectorAll(".selectable").forEach((el) => el.classList.remove("selectable"));

  // Re-render actions bar and re-attach listeners
  const actionsBar = container.querySelector("#actions-bar");
  if (actionsBar) {
    actionsBar.innerHTML = renderActions(validActions, state);
    actionsBar.querySelectorAll(".action-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLElement).dataset.actionIndex ?? "-1");
        const action = validActions[idx];
        if (action && onAction) {
          handleActionClick(action, validActions, state, container);
        }
      });
    });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
