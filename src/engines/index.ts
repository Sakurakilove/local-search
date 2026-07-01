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
 *  1. DuckDuckGo — least aggressive blocking, finest-grained date filter,
 *     best CJK support of the three.
 *  2. Bing       — usually stable from any IP including datacenter; the
 *     second-line fallback when DDG rate-limits us.
 *
 * Google is deliberately EXCLUDED from the auto chain. From datacenter /
 * cloud IPs Google returns a "please enable JS" redirect page with zero
 * parseable results ~95% of the time — including it just wastes 8s before
 * failing. Users who specifically want Google can pass `--engine google`
 * explicitly; from residential IPs it usually works fine.
 */
export const AUTO_ENGINE_ORDER: SearchEngineId[] = [
  "duckduckgo",
  "bing",
];
