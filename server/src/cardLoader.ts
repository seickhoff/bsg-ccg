import type { CardDef, BaseCardDef, CardRegistry } from "@bsg/shared";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ============================================================
// BSG CCG — Card Registry Loader
// Loads all card database JSON files into a unified CardRegistry.
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../shared/src/cardDatabase");

function loadJson<T>(filename: string): T {
  const raw = readFileSync(resolve(DB_PATH, filename), "utf-8");
  return JSON.parse(raw) as T;
}

export function loadCardRegistry(): CardRegistry {
  const bases = loadJson<Record<string, BaseCardDef>>("bases.json");
  const events = loadJson<Record<string, CardDef>>("events.json");
  const missions = loadJson<Record<string, CardDef>>("missions.json");
  const personnel = loadJson<Record<string, CardDef>>("personnel.json");
  const ships = loadJson<Record<string, CardDef>>("ships.json");

  const cards: Record<string, CardDef> = {
    ...events,
    ...missions,
    ...personnel,
    ...ships,
  };

  return { cards, bases };
}
