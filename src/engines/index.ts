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
 *     best CJK and long-tail-query support of the three.
 *  2. Bing       — usually stable from any IP including datacenter; the
 *     second-line fallback when DDG rate-limits us. Weak on long-tail
 *     technical queries (tends to return brand homepages), so the auto
 *     chain's quality gate will often skip past Bing to Google for those.
 *  3. Google     — best result quality when reachable. From datacenter IPs
 *     it usually returns a JS-required wall (~95% of the time), but when
 *     it does work (residential IP, or the rare datacenter success) it
 *     produces the most relevant results. Kept as a last-resort fallback.
 *
 * The quality-gate logic in `search()` may stop early at any engine that
 * returns a result set with quality >= 30 (i.e., at least 30% of results
 * mention a query token). If no engine clears the gate, the best one is
 * returned with a warning.
 */
export const AUTO_ENGINE_ORDER: SearchEngineId[] = [
  "duckduckgo",
  "bing",
  "google",
];

/**
 * Quality threshold below which the auto chain keeps looking for a better
 * engine. 30 means "at least 30% of results mention a query token in
 * title/url/snippet" — empirical testing showed this is a good divider
 * between "useful" and "garbage" result sets.
 */
export const AUTO_QUALITY_THRESHOLD = 30;
