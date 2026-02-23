import type { CardDef, BaseCardDef, CardRegistry } from "@bsg/shared";

// ============================================================
// BSG CCG — Shared Card Preview Overlay
// Full-screen overlay showing a card image + details.
// Usable from deck builder, gameboard, or anywhere else.
// ============================================================

let registry: CardRegistry | null = null;
let onClose: (() => void) | null = null;
let overlayEl: HTMLElement | null = null;

export function setPreviewRegistry(reg: CardRegistry): void {
  registry = reg;
}

/** Show preview for a card def id (card or base). */
export function showCardPreview(defId: string, opts?: { onClose?: () => void }): void {
  if (!registry) return;
  onClose = opts?.onClose ?? null;

  const card = registry.cards[defId];
  const base = registry.bases[defId];
  if (!card && !base) return;

  const html = base ? renderBasePreview(base) : renderCardPreview(card!);
  mount(html);
}

/** Close any open preview. */
export function closeCardPreview(): void {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  if (onClose) {
    onClose();
    onClose = null;
  }
}

// --- Renderers ---

function renderCardPreview(c: CardDef): string {
  const altText =
    c.title && c.subtitle ? `${c.title}, ${c.subtitle}` : (c.title ?? c.subtitle ?? c.id);
  return `
    <div class="card-pv-overlay">
      <div class="card-pv">
        ${c.image ? `<img src="${c.image}" alt="${esc(altText)}" class="card-pv-img" />` : ""}
        <div class="card-pv-info">
          ${c.title ? `<div class="card-pv-name">${esc(c.title)}</div>` : ""}
          ${c.subtitle ? `<div class="card-pv-subtitle">${esc(c.subtitle)}</div>` : ""}
          <div class="card-pv-detail">${c.type} · ${formatCost(c.cost)}</div>
          ${c.power != null ? `<div class="card-pv-detail">Power: ${c.power} · Mystic: ${c.mysticValue ?? 0} · CT: ${c.cylonThreat ?? 0}</div>` : ""}
          ${c.resource ? `<div class="card-pv-detail">Resource: ${c.resource}</div>` : ""}
          ${c.traits?.length ? `<div class="card-pv-detail">Traits: ${c.traits.join(", ")}</div>` : ""}
          ${c.keywords?.length ? `<div class="card-pv-detail">Keywords: ${c.keywords.join(", ")}</div>` : ""}
          ${c.resolveText ? `<div class="card-pv-ability">${esc(c.resolveText)}</div>` : ""}
          <div class="card-pv-ability">${esc(c.abilityText)}</div>
          ${c.cylonThreatText ? `<div class="card-pv-threat">${esc(c.cylonThreatText)}</div>` : ""}
          ${c.flavorText ? `<div class="card-pv-flavor">${esc(c.flavorText)}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderBasePreview(b: BaseCardDef): string {
  return `
    <div class="card-pv-overlay">
      <div class="card-pv">
        <img src="${b.image}" alt="${esc(b.title)}" class="card-pv-img card-clip-landscape" />
        <div class="card-pv-info">
          <div class="card-pv-name">${esc(b.title)}</div>
          <div class="card-pv-detail">Power: ${b.power} · Influence: ${b.startingInfluence} · Hand: ${b.handSize}</div>
          <div class="card-pv-detail">Resource: ${b.resource}</div>
          <div class="card-pv-ability">${esc(b.abilityText)}</div>
        </div>
      </div>
    </div>
  `;
}

// --- Mount / wire ---

function mount(html: string): void {
  // Remove any existing overlay
  closeCardPreview();

  const div = document.createElement("div");
  div.innerHTML = html;
  overlayEl = div.firstElementChild as HTMLElement;
  document.body.appendChild(overlayEl);

  // Any click closes
  overlayEl.addEventListener("click", closeCardPreview);
}

// --- Helpers ---

function formatCost(cost: CardDef["cost"]): string {
  if (!cost) return "Free";
  return Object.entries(cost)
    .map(([res, amt]) => `${amt} ${res}`)
    .join(", ");
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
