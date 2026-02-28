import type { CardDef, BaseCardDef, CardRegistry } from "@bsg/shared";

// ============================================================
// BSG CCG — Shared Card Preview Overlay
// Full-screen overlay showing a card image + details.
// Supports optional prev/next navigation through a list.
// ============================================================

let registry: CardRegistry | null = null;
let onClose: (() => void) | null = null;
let overlayEl: HTMLElement | null = null;

// Navigation state
let navList: string[] = [];
let navIndex = 0;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function setPreviewRegistry(reg: CardRegistry): void {
  registry = reg;
}

/** Show preview for a single card def id (no navigation). */
export function showCardPreview(defId: string, opts?: { onClose?: () => void }): void {
  if (!registry) return;
  onClose = opts?.onClose ?? null;
  navList = [];
  navIndex = 0;
  renderForDefId(defId);
}

/** Show preview with prev/next navigation through a list of defIds. */
export function showCardPreviewNav(
  defIds: string[],
  startIndex: number,
  opts?: { onClose?: () => void },
): void {
  if (!registry || defIds.length === 0) return;
  onClose = opts?.onClose ?? null;
  navList = defIds;
  navIndex = Math.max(0, Math.min(startIndex, defIds.length - 1));
  renderForDefId(navList[navIndex]);
}

/** Close any open preview. */
export function closeCardPreview(): void {
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  navList = [];
  navIndex = 0;
  if (onClose) {
    onClose();
    onClose = null;
  }
}

function navigate(delta: number): void {
  if (navList.length < 2) return;
  navIndex = (navIndex + delta + navList.length) % navList.length;
  const savedOnClose = onClose;
  onClose = null; // prevent onClose firing during re-render
  renderForDefId(navList[navIndex]);
  onClose = savedOnClose;
}

function renderForDefId(defId: string): void {
  if (!registry) return;
  const card = registry.cards[defId];
  const base = registry.bases[defId];
  if (!card && !base) return;

  const contentHtml = base ? renderBaseContent(base) : renderCardContent(card!);
  const hasNav = navList.length > 1;
  const posText = hasNav ? `${navIndex + 1} / ${navList.length}` : "";

  const html = `
    <div class="card-pv-overlay">
      ${hasNav ? '<button class="card-pv-nav card-pv-nav-prev" id="pv-prev">&#8249;</button>' : ""}
      <div class="card-pv">
        ${posText ? `<div class="card-pv-pos">${posText}</div>` : ""}
        ${contentHtml}
      </div>
      ${hasNav ? '<button class="card-pv-nav card-pv-nav-next" id="pv-next">&#8250;</button>' : ""}
    </div>
  `;
  mount(html, hasNav);
}

// --- Content renderers (no outer overlay wrapper) ---

function renderCardContent(c: CardDef): string {
  const altText =
    c.title && c.subtitle ? `${c.title}, ${c.subtitle}` : (c.title ?? c.subtitle ?? c.id);
  return `
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
  `;
}

function renderBaseContent(b: BaseCardDef): string {
  return `
    <img src="${b.image}" alt="${esc(b.title)}" class="card-pv-img card-clip-landscape" />
    <div class="card-pv-info">
      <div class="card-pv-name">${esc(b.title)}</div>
      <div class="card-pv-detail">Power: ${b.power} · Influence: ${b.startingInfluence} · Hand: ${b.handSize}</div>
      <div class="card-pv-detail">Resource: ${b.resource}</div>
      <div class="card-pv-ability">${esc(b.abilityText)}</div>
    </div>
  `;
}

// --- Mount / wire ---

function mount(html: string, hasNav: boolean): void {
  // Remove existing overlay without triggering onClose
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }

  const div = document.createElement("div");
  div.innerHTML = html;
  overlayEl = div.firstElementChild as HTMLElement;
  document.body.appendChild(overlayEl);

  // Click anywhere in overlay closes (except nav buttons)
  overlayEl.addEventListener("click", () => {
    closeCardPreview();
  });

  // Nav button clicks
  if (hasNav) {
    overlayEl.querySelector("#pv-prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate(-1);
    });
    overlayEl.querySelector("#pv-next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate(1);
    });

    // Keyboard nav
    keyHandler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(1);
      } else if (e.key === "Escape") {
        closeCardPreview();
      }
    };
    document.addEventListener("keydown", keyHandler);

    // Swipe support
    let touchStartX = 0;
    overlayEl.addEventListener(
      "touchstart",
      (e) => {
        touchStartX = e.touches[0].clientX;
      },
      { passive: true },
    );
    overlayEl.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) {
        navigate(dx < 0 ? 1 : -1);
      }
    });
  }
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
