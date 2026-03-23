import type { CardDef, BaseCardDef, CardRegistry, Trait, Keyword } from "@bsg/shared";
import { escapeHtml as esc } from "./utils.js";

// ============================================================
// BSG CCG — Shared Card Preview Overlay
// Full-screen overlay showing a card image + details.
// Supports optional prev/next navigation through a list.
// ============================================================

const SCOPE_LABELS = {
  phase: "this phase",
  turn: "this turn",
  challenge: "this challenge",
} as const;

export type ModScope = keyof typeof SCOPE_LABELS;

export interface ScopedMod<T> {
  value: T;
  scope: ModScope;
}

/** Runtime info overlay for units on the board (power buffs, granted traits, etc.) */
export interface CardRuntimeInfo {
  powerBuff?: number; // execution-phase buff (scope always "phase")
  passivePowerBuff?: number; // passive aura buff (Apollo CAG, Galactica, etc.)
  challengeBuff?: number; // challenge buff (scope always "challenge")
  grantedTraits?: ScopedMod<Trait>[];
  removedTraits?: ScopedMod<Trait>[];
  grantedKeywords?: ScopedMod<Keyword>[];
  exhausted?: boolean;
  stackSize?: number;
  effectImmunity?: "power" | "all";
}

let registry: CardRegistry | null = null;
let onClose: (() => void) | null = null;
let overlayEl: HTMLElement | null = null;

/** Remove an element while preserving .boards scroll position (mobile fix). */
function removePreservingScroll(el: Element): void {
  const boards = document.querySelector(".boards");
  const scrollTop = boards ? boards.scrollTop : 0;
  el.remove();
  if (boards) boards.scrollTop = scrollTop;
}

// Navigation state
let navList: string[] = [];
let navIndex = 0;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let currentRuntime: CardRuntimeInfo | null = null;
let runtimeMap: Map<string, CardRuntimeInfo> | null = null;

export function setPreviewRegistry(reg: CardRegistry): void {
  registry = reg;
}

/** Show preview for a single card def id (no navigation). */
export function showCardPreview(
  defId: string,
  opts?: { onClose?: () => void; runtime?: CardRuntimeInfo },
): void {
  if (!registry) return;
  onClose = opts?.onClose ?? null;
  currentRuntime = opts?.runtime ?? null;
  runtimeMap = null;
  navList = [];
  navIndex = 0;
  renderForDefId(defId);
}

/** Show preview with prev/next navigation through a list of defIds. */
export function showCardPreviewNav(
  defIds: string[],
  startIndex: number,
  opts?: { onClose?: () => void; runtimeByDefId?: Map<string, CardRuntimeInfo> },
): void {
  if (!registry || defIds.length === 0) return;
  onClose = opts?.onClose ?? null;
  currentRuntime = null;
  runtimeMap = opts?.runtimeByDefId ?? null;
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
    removePreservingScroll(overlayEl);
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

  const rt = currentRuntime ?? runtimeMap?.get(defId) ?? null;
  const contentHtml = base ? renderBaseContent(base) : renderCardContent(card!, rt);
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

function renderCardContent(c: CardDef, rt: CardRuntimeInfo | null): string {
  const altText =
    c.title && c.subtitle ? `${c.title}, ${c.subtitle}` : (c.title ?? c.subtitle ?? c.id);

  // Power with runtime buffs
  let powerHtml = "";
  if (c.power != null) {
    const basePower = c.power;
    const phaseBuff = rt?.powerBuff ?? 0;
    const passiveBuff = rt?.passivePowerBuff ?? 0;
    const challBuff = rt?.challengeBuff ?? 0;
    const buff = phaseBuff + passiveBuff + challBuff;
    const total = basePower + buff;
    if (buff !== 0) {
      const parts: string[] = [`base ${basePower}`];
      if (passiveBuff)
        parts.push(
          `${passiveBuff > 0 ? "+" : ""}${passiveBuff} <span class="card-pv-scope">passive</span>`,
        );
      if (phaseBuff)
        parts.push(
          `${phaseBuff > 0 ? "+" : ""}${phaseBuff} <span class="card-pv-scope">this phase</span>`,
        );
      if (challBuff)
        parts.push(
          `${challBuff > 0 ? "+" : ""}${challBuff} <span class="card-pv-scope">this challenge</span>`,
        );
      powerHtml = `<div class="card-pv-detail">Power: <span class="card-pv-power-buffed">${total}</span> <span class="card-pv-power-detail">(${parts.join(", ")})</span></div>`;
    } else {
      powerHtml = `<div class="card-pv-detail">Power: ${basePower} · Mystic: ${c.mysticValue ?? 0} · CT: ${c.cylonThreat ?? 0}</div>`;
    }
    if (buff !== 0) {
      powerHtml += `<div class="card-pv-detail">Mystic: ${c.mysticValue ?? 0} · CT: ${c.cylonThreat ?? 0}</div>`;
    }
  }

  // Traits with grants/removals
  const baseTraits = c.traits ?? [];
  const granted = rt?.grantedTraits ?? [];
  const removed = rt?.removedTraits ?? [];
  const hasTraitMods = granted.length > 0 || removed.length > 0;
  let traitsHtml = "";
  if (baseTraits.length > 0 || hasTraitMods) {
    const parts: string[] = [];
    for (const t of baseTraits) {
      const rem = removed.find((r) => r.value === t);
      if (rem) {
        parts.push(
          `<span class="card-pv-trait-removed">${t}</span> <span class="card-pv-scope">${SCOPE_LABELS[rem.scope]}</span>`,
        );
      } else {
        parts.push(t);
      }
    }
    for (const t of granted) {
      parts.push(
        `<span class="card-pv-trait-granted">+${t.value}</span> <span class="card-pv-scope">${SCOPE_LABELS[t.scope]}</span>`,
      );
    }
    traitsHtml = `<div class="card-pv-detail">Traits: ${parts.join(", ")}</div>`;
  }

  // Keywords with grants
  const baseKeywords = c.keywords ?? [];
  const grantedKw = rt?.grantedKeywords ?? [];
  let keywordsHtml = "";
  if (baseKeywords.length > 0 || grantedKw.length > 0) {
    const parts: string[] = [...baseKeywords];
    for (const kw of grantedKw) {
      parts.push(
        `<span class="card-pv-trait-granted">+${kw.value}</span> <span class="card-pv-scope">${SCOPE_LABELS[kw.scope]}</span>`,
      );
    }
    keywordsHtml = `<div class="card-pv-detail">Keywords: ${parts.join(", ")}</div>`;
  }

  // Status line (exhausted, stack size, immunity)
  const statusParts: string[] = [];
  if (rt?.exhausted) statusParts.push("Exhausted");
  if (rt?.stackSize && rt.stackSize > 1) statusParts.push(`Stack: ${rt.stackSize} cards`);
  if (rt?.effectImmunity === "all")
    statusParts.push('<span class="card-pv-immune">Immune to all effects</span>');
  else if (rt?.effectImmunity === "power")
    statusParts.push('<span class="card-pv-immune">Immune to power changes</span>');
  const statusHtml = statusParts.length
    ? `<div class="card-pv-detail card-pv-status">${statusParts.join(" · ")}</div>`
    : "";

  return `
    ${c.image ? `<img src="${c.image}" alt="${esc(altText)}" class="card-pv-img" />` : ""}
    <div class="card-pv-info">
      ${c.title ? `<div class="card-pv-name">${esc(c.title)}</div>` : ""}
      ${c.subtitle ? `<div class="card-pv-subtitle">${esc(c.subtitle)}</div>` : ""}
      <div class="card-pv-detail">${c.type} · ${formatCost(c.cost)}</div>
      ${powerHtml}
      ${c.resource ? `<div class="card-pv-detail">Resource: ${c.resource}</div>` : ""}
      ${traitsHtml}
      ${keywordsHtml}
      ${statusHtml}
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
    removePreservingScroll(overlayEl);
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
