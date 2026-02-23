import type {
  CardDef,
  BaseCardDef,
  CardRegistry,
  CardType,
  ResourceType,
  DeckSubmission,
} from "@bsg/shared";
import { validateDeck } from "@bsg/shared";
import { saveDeck, loadDeck } from "./deck-storage.js";

// ============================================================
// BSG CCG — Deck Builder UI
// Mobile-first: single scrollable list, one card per row,
// section labels by type, full-size card preview overlay.
// ============================================================

type Tab = "base" | "cards" | "deck";

interface DeckBuilderState {
  registry: CardRegistry;
  selectedBaseId: string | null;
  deckCards: Map<string, number>;
  filterType: CardType | "all";
  filterResource: ResourceType | "all";
  filterSearch: string;
  activeTab: Tab;
  previewId: string | null;
  previewIsBase: boolean;
  onSubmit: (submission: DeckSubmission) => void;
}

let state: DeckBuilderState | null = null;
let container: HTMLElement | null = null;

export function renderDeckBuilder(
  el: HTMLElement,
  registry: CardRegistry,
  onSubmit: (submission: DeckSubmission) => void,
): void {
  container = el;
  const saved = loadDeck();

  state = {
    registry,
    selectedBaseId: saved?.baseId ?? null,
    deckCards: new Map(),
    filterType: "all",
    filterResource: "all",
    filterSearch: "",
    activeTab: "base",
    previewId: null,
    previewIsBase: false,
    onSubmit,
  };

  if (saved) {
    for (const id of saved.deckCardIds) {
      state.deckCards.set(id, (state.deckCards.get(id) ?? 0) + 1);
    }
    if (saved.baseId && saved.deckCardIds.length > 0) {
      state.activeTab = "cards";
    }
  }

  render();
}

// --- Helpers ---

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardName(c: { title?: string; subtitle?: string; id: string }): string {
  if (c.title && c.subtitle) return `${c.title}, ${c.subtitle}`;
  return c.subtitle ?? c.title ?? c.id;
}

function costStr(cost: CardDef["cost"]): string {
  if (!cost) return "Free";
  return Object.entries(cost)
    .map(([r, a]) => `${a} ${r.charAt(0).toUpperCase()}${r.slice(1)}`)
    .join(", ");
}

function deckIds(): string[] {
  if (!state) return [];
  const ids: string[] = [];
  for (const [id, n] of state.deckCards) for (let i = 0; i < n; i++) ids.push(id);
  return ids;
}

function deckSize(): number {
  if (!state) return 0;
  let t = 0;
  for (const n of state.deckCards.values()) t += n;
  return t;
}

function getValidation(): { valid: boolean; errors: string[] } {
  if (!state?.selectedBaseId) return { valid: false, errors: ["Select a base card"] };
  return validateDeck({ baseId: state.selectedBaseId, deckCardIds: deckIds() }, state.registry);
}

function identityName(d: CardDef): string {
  if (d.title && d.subtitle) return `${d.title}, ${d.subtitle}`;
  return d.subtitle ?? d.title ?? d.id;
}

function copiesByName(d: CardDef): number {
  if (!state) return 0;
  const target = identityName(d);
  let t = 0;
  for (const [id, n] of state.deckCards) {
    const c = state.registry.cards[id];
    if (c && identityName(c) === target) t += n;
  }
  return t;
}

function getDeckStats() {
  const s = { personnel: 0, ship: 0, event: 0, mission: 0 };
  if (!state) return s;
  for (const [id, n] of state.deckCards) {
    const c = state.registry.cards[id];
    if (c) s[c.type] = (s[c.type] ?? 0) + n;
  }
  return s;
}

// --- Render ---

function render(): void {
  if (!state || !container) return;
  const v = getValidation();
  const sz = deckSize();
  const stats = getDeckStats();

  // Preserve scroll position across re-renders
  const body = container.querySelector(".db-body");
  const scrollTop = body?.scrollTop ?? 0;

  container.innerHTML = `
    <div class="db">
      <div class="db-header">
        <div class="db-header-left">
          <span class="db-title">Deck Builder</span>
          <span class="db-count ${sz >= 60 ? "valid" : "invalid"}">${sz}/60</span>
          <span class="db-stats-inline">
            P:${stats.personnel} S:${stats.ship} E:${stats.event} M:${stats.mission}
          </span>
        </div>
        <button class="db-play-btn" id="db-play" ${v.valid ? "" : "disabled"}>Play</button>
      </div>

      <div class="db-tabs">
        <button class="db-tab ${state.activeTab === "base" ? "active" : ""}" data-tab="base">Base${state.selectedBaseId ? " &#10003;" : ""}</button>
        <button class="db-tab ${state.activeTab === "cards" ? "active" : ""}" data-tab="cards">Cards</button>
        <button class="db-tab ${state.activeTab === "deck" ? "active" : ""}" data-tab="deck">Deck (${sz})</button>
      </div>

      <div class="db-body">
        ${state.activeTab === "base" ? renderBaseTab() : ""}
        ${state.activeTab === "cards" ? renderCardsTab() : ""}
        ${state.activeTab === "deck" ? renderDeckTab(v) : ""}
      </div>

      ${state.previewId ? renderPreview() : ""}
    </div>
  `;

  attach();

  // Restore scroll position
  const newBody = container.querySelector(".db-body");
  if (newBody) newBody.scrollTop = scrollTop;
}

// --- Base tab ---

function renderBaseTab(): string {
  if (!state) return "";
  return Object.values(state.registry.bases)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((b) => {
      const sel = state!.selectedBaseId === b.id;
      return `
      <div class="db-row db-base-row ${sel ? "active" : ""}">
        <div class="db-row-thumb" data-preview-base="${b.id}">
          <img src="${b.image}" alt="${esc(b.title)}" class="card-clip-landscape" loading="lazy" />
        </div>
        <div class="db-row-info" data-preview-base="${b.id}">
          <div class="db-row-name">${esc(b.title)}</div>
          <div class="db-row-meta">Power ${b.power} · Influence ${b.startingInfluence} · Hand ${b.handSize}</div>
          <div class="db-row-sub">${b.resource}</div>
        </div>
        <button class="db-select-btn ${sel ? "selected" : ""}" data-base-id="${b.id}">
          ${sel ? "&#10003;" : "Select"}
        </button>
      </div>
    `;
    })
    .join("");
}

// --- Cards tab ---

function filterCards(): CardDef[] {
  if (!state) return [];
  let cards = Object.values(state.registry.cards);

  if (state.filterType !== "all") {
    cards = cards.filter((c) => c.type === state!.filterType);
  }
  if (state.filterResource !== "all") {
    cards = cards.filter((c) => {
      if (c.resource === state!.filterResource) return true;
      return c.cost && (c.cost as Record<string, number>)[state!.filterResource] !== undefined;
    });
  }
  if (state.filterSearch) {
    const s = state.filterSearch.toLowerCase();
    cards = cards.filter((c) => {
      return (
        cardName(c).toLowerCase().includes(s) ||
        (c.traits ?? []).join(" ").toLowerCase().includes(s) ||
        c.abilityText.toLowerCase().includes(s)
      );
    });
  }

  cards.sort((a, b) => cardName(a).localeCompare(cardName(b)));

  return cards;
}

function renderCardsTab(): string {
  if (!state) return "";
  const cards = filterCards();

  return `
    <div class="db-filters">
      <input type="text" id="db-search" class="db-input" placeholder="Search..." value="${esc(state.filterSearch)}" />
      <div class="db-filter-row">
        <select id="db-filter-type" class="db-select">
          <option value="all" ${state.filterType === "all" ? "selected" : ""}>All Types</option>
          <option value="personnel" ${state.filterType === "personnel" ? "selected" : ""}>Personnel</option>
          <option value="ship" ${state.filterType === "ship" ? "selected" : ""}>Ship</option>
          <option value="event" ${state.filterType === "event" ? "selected" : ""}>Event</option>
          <option value="mission" ${state.filterType === "mission" ? "selected" : ""}>Mission</option>
        </select>
        <select id="db-filter-resource" class="db-select">
          <option value="all" ${state.filterResource === "all" ? "selected" : ""}>All Resources</option>
          <option value="security" ${state.filterResource === "security" ? "selected" : ""}>Security</option>
          <option value="persuasion" ${state.filterResource === "persuasion" ? "selected" : ""}>Persuasion</option>
          <option value="logistics" ${state.filterResource === "logistics" ? "selected" : ""}>Logistics</option>
        </select>
      </div>
    </div>
    <div class="db-card-list" id="db-card-list">
      ${cards.length === 0 ? '<div class="db-empty">No cards match</div>' : renderCardRows(cards)}
    </div>
  `;
}

function renderCardRows(cards: CardDef[]): string {
  if (!state) return "";
  let html = "";

  for (const c of cards) {
    const n = state.deckCards.get(c.id) ?? 0;
    const maxed = copiesByName(c) >= 4;

    html += `
      <div class="db-row ${c.type} ${n > 0 ? "active" : ""} ${maxed && n === 0 ? "maxed" : ""}">
        <div class="db-row-thumb" data-preview-card="${c.id}">
          ${c.image ? `<img src="${c.image}" alt="" loading="lazy" />` : `<div class="db-row-thumb-ph">${c.type.charAt(0).toUpperCase()}</div>`}
        </div>
        <div class="db-row-info" data-preview-card="${c.id}">
          <div class="db-row-name">${esc(cardName(c))}</div>
          <div class="db-row-meta">${costStr(c.cost)}${c.power != null ? ` · P:${c.power}` : ""}${c.resource ? ` · ${c.resource}` : ""}</div>
          ${c.traits?.length ? `<div class="db-row-sub">${c.traits.join(", ")}</div>` : ""}
        </div>
        <div class="db-row-count">
          <button class="db-count-btn" data-remove="${c.id}" ${n === 0 ? "disabled" : ""}>-</button>
          <span class="db-count-val ${n > 0 ? "has" : ""}">${n}</span>
          <button class="db-count-btn" data-add="${c.id}" ${maxed ? "disabled" : ""}>+</button>
        </div>
      </div>
    `;
  }
  return html;
}

// --- Deck tab ---

function renderDeckTab(v: { valid: boolean; errors: string[] }): string {
  if (!state) return "";

  const baseDef = state.selectedBaseId ? state.registry.bases[state.selectedBaseId] : null;
  const entries: { card: CardDef; count: number }[] = [];
  for (const [id, n] of state.deckCards) {
    const c = state.registry.cards[id];
    if (c) entries.push({ card: c, count: n });
  }
  entries.sort((a, b) => cardName(a.card).localeCompare(cardName(b.card)));

  const stats = getDeckStats();
  const unitCount = stats.personnel + stats.ship;

  return `
    ${
      baseDef
        ? `
      <div class="db-row db-base-row active" data-preview-base="${baseDef.id}">
        <div class="db-row-thumb"><img src="${baseDef.image}" alt="${esc(baseDef.title)}" class="card-clip-landscape" /></div>
        <div class="db-row-info">
          <div class="db-row-name">${esc(baseDef.title)}</div>
          <div class="db-row-meta">${baseDef.resource} · P:${baseDef.power} I:${baseDef.startingInfluence} H:${baseDef.handSize}</div>
        </div>
      </div>
    `
        : '<div class="db-empty">No base selected</div>'
    }

    <div class="db-deck-stats">
      <span>P:${stats.personnel}</span>
      <span>S:${stats.ship}</span>
      <span class="${unitCount < 30 ? "warn" : ""}">Units:${unitCount}</span>
      <span>E:${stats.event}</span>
      <span>M:${stats.mission}</span>
    </div>

    ${v.errors.length > 0 ? `<div class="db-errors">${v.errors.map((e) => `<div class="db-error">${esc(e)}</div>`).join("")}</div>` : ""}

    ${entries.length === 0 ? '<div class="db-empty">No cards — go to Cards tab</div>' : ""}
    ${entries
      .map(
        ({ card: c, count: n }) => `
      <div class="db-row ${c.type} active">
        <div class="db-row-thumb" data-preview-card="${c.id}">
          ${c.image ? `<img src="${c.image}" alt="" loading="lazy" />` : ""}
        </div>
        <div class="db-row-info" data-preview-card="${c.id}">
          <div class="db-row-name">${esc(cardName(c))}</div>
          <div class="db-row-meta">${c.type} · ${costStr(c.cost)}</div>
        </div>
        <div class="db-row-count">
          <button class="db-count-btn" data-remove="${c.id}">-</button>
          <span class="db-count-val has">${n}</span>
          <button class="db-count-btn" data-add="${c.id}" ${copiesByName(c) >= 4 ? "disabled" : ""}>+</button>
        </div>
      </div>
    `,
      )
      .join("")}
  `;
}

// --- Preview overlay ---

function renderPreview(): string {
  if (!state?.previewId) return "";

  let img = "";
  let name = "";
  let details = "";
  let actions = "";

  if (state.previewIsBase) {
    const b = state.registry.bases[state.previewId];
    if (!b) return "";
    img = b.image;
    name = b.title;
    details = `
      <div class="db-pv-detail">Power: ${b.power} · Influence: ${b.startingInfluence} · Hand: ${b.handSize}</div>
      <div class="db-pv-detail">Resource: ${b.resource}</div>
      <div class="db-pv-ability">${esc(b.abilityText)}</div>
    `;
    const sel = state.selectedBaseId === b.id;
    actions = `<button class="db-pv-base-btn ${sel ? "selected" : ""}" data-base-id="${b.id}">${sel ? "Selected &#10003;" : "Select This Base"}</button>`;
  } else {
    const c = state.registry.cards[state.previewId];
    if (!c) return "";
    img = c.image ?? "";
    name = cardName(c);
    const n = state.deckCards.get(c.id) ?? 0;
    const maxed = copiesByName(c) >= 4;
    details = `
      <div class="db-pv-detail">${c.type} · ${costStr(c.cost)}</div>
      ${c.power != null ? `<div class="db-pv-detail">Power: ${c.power} · Mystic: ${c.mysticValue ?? 0} · CT: ${c.cylonThreat ?? 0}</div>` : ""}
      ${c.resource ? `<div class="db-pv-detail">Resource: ${c.resource}</div>` : ""}
      ${c.traits?.length ? `<div class="db-pv-detail">Traits: ${c.traits.join(", ")}</div>` : ""}
      ${c.keywords?.length ? `<div class="db-pv-detail">Keywords: ${c.keywords.join(", ")}</div>` : ""}
      ${c.resolveText ? `<div class="db-pv-ability">${esc(c.resolveText)}</div>` : ""}
      <div class="db-pv-ability">${esc(c.abilityText)}</div>
      ${c.flavorText ? `<div class="db-pv-flavor">${esc(c.flavorText)}</div>` : ""}
    `;
    actions = `
      <div class="db-pv-actions">
        <button class="db-count-btn db-pv-btn" data-remove="${c.id}" ${n === 0 ? "disabled" : ""}>- Remove</button>
        <span class="db-pv-count">${n} in deck${maxed ? " (max)" : ""}</span>
        <button class="db-count-btn db-pv-btn" data-add="${c.id}" ${maxed ? "disabled" : ""}>+ Add</button>
      </div>
    `;
  }

  return `
    <div class="db-preview-overlay" id="db-overlay">
      <div class="db-preview">
        <button class="db-preview-close" id="db-pv-close">&times;</button>
        ${img ? `<img src="${img}" alt="${esc(name)}" class="db-preview-img${state?.previewIsBase ? " card-clip-landscape" : ""}" />` : ""}
        <div class="db-preview-info">
          <div class="db-pv-name">${esc(name)}</div>
          ${details}
          ${actions}
        </div>
      </div>
    </div>
  `;
}

// --- Events ---

function attach(): void {
  if (!state || !container) return;

  // Tabs
  container.querySelectorAll(".db-tab").forEach((b) =>
    b.addEventListener("click", () => {
      state!.activeTab = (b as HTMLElement).dataset.tab as Tab;
      render();
    }),
  );

  // Play
  container.querySelector("#db-play")?.addEventListener("click", () => {
    if (!state?.selectedBaseId || !getValidation().valid) return;
    autoSave();
    state.onSubmit({ baseId: state.selectedBaseId, deckCardIds: deckIds() });
  });

  // Base select
  container.querySelectorAll(".db-select-btn, .db-pv-base-btn").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      state!.selectedBaseId = (b as HTMLElement).dataset.baseId!;
      autoSave();
      render();
    }),
  );

  // Add/remove
  container.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      addCard((b as HTMLElement).dataset.add!);
    }),
  );
  container.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      removeCard((b as HTMLElement).dataset.remove!);
    }),
  );

  // Preview card
  container.querySelectorAll("[data-preview-card]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      state!.previewId = (el as HTMLElement).dataset.previewCard!;
      state!.previewIsBase = false;
      render();
    }),
  );

  // Preview base
  container.querySelectorAll("[data-preview-base]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      state!.previewId = (el as HTMLElement).dataset.previewBase!;
      state!.previewIsBase = true;
      render();
    }),
  );

  // Close preview
  container.querySelector("#db-pv-close")?.addEventListener("click", () => {
    state!.previewId = null;
    render();
  });
  container.querySelector("#db-overlay")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "db-overlay") {
      state!.previewId = null;
      render();
    }
  });

  // Filters
  const search = container.querySelector("#db-search") as HTMLInputElement;
  search?.addEventListener("input", () => {
    state!.filterSearch = search.value;
    updateCardList();
  });
  const typeF = container.querySelector("#db-filter-type") as HTMLSelectElement;
  typeF?.addEventListener("change", () => {
    state!.filterType = typeF.value as CardType | "all";
    updateCardList();
  });
  const resF = container.querySelector("#db-filter-resource") as HTMLSelectElement;
  resF?.addEventListener("change", () => {
    state!.filterResource = resF.value as ResourceType | "all";
    updateCardList();
  });
}

function updateCardList(): void {
  if (!container || !state) return;
  const el = container.querySelector("#db-card-list");
  if (!el) return;
  const cards = filterCards();
  el.innerHTML =
    cards.length === 0 ? '<div class="db-empty">No cards match</div>' : renderCardRows(cards);

  el.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      addCard((b as HTMLElement).dataset.add!);
    }),
  );
  el.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      removeCard((b as HTMLElement).dataset.remove!);
    }),
  );
  el.querySelectorAll("[data-preview-card]").forEach((el2) =>
    el2.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      state!.previewId = (el2 as HTMLElement).dataset.previewCard!;
      state!.previewIsBase = false;
      render();
    }),
  );
}

// --- State ---

function addCard(id: string): void {
  if (!state) return;
  const d = state.registry.cards[id];
  if (!d || copiesByName(d) >= 4) return;
  state.deckCards.set(id, (state.deckCards.get(id) ?? 0) + 1);
  autoSave();
  if (state.activeTab === "cards") {
    updateCardList();
    updateHeader();
  } else {
    render();
  }
}

function removeCard(id: string): void {
  if (!state) return;
  const n = state.deckCards.get(id) ?? 0;
  if (n <= 1) state.deckCards.delete(id);
  else state.deckCards.set(id, n - 1);
  autoSave();
  if (state.activeTab === "cards") {
    updateCardList();
    updateHeader();
  } else {
    render();
  }
}

function updateHeader(): void {
  if (!state || !container) return;
  const sz = deckSize();
  const stats = getDeckStats();
  const v = getValidation();
  const countEl = container.querySelector(".db-count");
  if (countEl) {
    countEl.textContent = `${sz}/60`;
    countEl.className = `db-count ${sz >= 60 ? "valid" : "invalid"}`;
  }
  const statsEl = container.querySelector(".db-stats-inline");
  if (statsEl)
    statsEl.textContent = `P:${stats.personnel} S:${stats.ship} E:${stats.event} M:${stats.mission}`;
  const playBtn = container.querySelector("#db-play") as HTMLButtonElement;
  if (playBtn) playBtn.disabled = !v.valid;
  const deckTab = container.querySelector('[data-tab="deck"]');
  if (deckTab) deckTab.textContent = `Deck (${sz})`;
}

function autoSave(): void {
  if (!state) return;
  saveDeck({ baseId: state.selectedBaseId ?? "", deckCardIds: deckIds() });
}
