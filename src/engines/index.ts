/**
 * Engine registry.
 *
 * Single source of truth for which engines exist + the order `auto` tries
 * them in. Adjust the order here if you want a different default priority.
 */
import type { SearchEngine, SearchEngineId } from "../types.js";
import { duckduckgoEngine } from "./duckduckgo.js";
import { bingEngine } from "./bing.js";
import { googleEngine } from "./google.js";

export { duckduckgoEngine, bingEngine, googleEngine };

/** All engines, keyed by id. */
export const ENGINES: Record<SearchEngineId, SearchEngine> = {
  duckduckgo: duckduckgoEngine,
  bing: bingEngine,
  google: googleEngine,
};

/**
 * Order used by `engine: "auto"`.
 *
 * Rationale:
 *  1. DuckDuckGo — least aggressive blocking, no consent walls.
 *  2. Bing       — usually stable, occasional locale quirks.
 *  3. Google     — best results, but most likely to be blocked / consented.
 */
export const AUTO_ENGINE_ORDER: SearchEngineId[] = [
  "duckduckgo",
  "bing",
  "google",
];
