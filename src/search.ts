/**
 * Search orchestrator.
 *
 * `search()` is the single entry point used by both the CLI and the SDK.
 * It normalizes options, dispatches to one or more engine backends, and
 * implements the `auto` fallback chain.
 */
import {
  AllEnginesFailedError,
  type SearchEngineId,
  type SearchFunctionResultItem,
  type SearchOptions,
} from "./types.js";
import { DEFAULT_USER_AGENT, ENGINE_IDS } from "./engines/_shared.js";
import { AUTO_ENGINE_ORDER, ENGINES } from "./engines/index.js";

export interface SearchSuccess<T extends "single" | "auto" = "single" | "auto"> {
  success: true;
  results: SearchFunctionResultItem[];
  /** Which engine produced these results. Equal to the requested id for `single`. */
  engine: SearchEngineId;
  /** How many engines were tried (1 for explicit, possibly >1 for `auto`). */
  enginesTried: T extends "auto" ? SearchEngineId[] : [SearchEngineId];
  /** How long the call took in ms. */
  elapsedMs: number;
}

export interface SearchFailure {
  success: false;
  error: string;
  /** Only populated under `engine: "auto"` — list of all engine errors. */
  errors?: Array<{ engine: SearchEngineId; error: unknown }>;
  elapsedMs: number;
}

export type SearchOutcome = SearchSuccess<"single"> | SearchSuccess<"auto"> | SearchFailure;

/** Normalize the user-supplied options into a fully-resolved shape. */
function resolveOptions(opts: SearchOptions = {}) {
  const num = Math.max(1, Math.min(opts.num ?? 10, 50));
  const recency_days = Math.max(0, Math.min(opts.recency_days ?? 0, 365));
  const timeoutMs = Math.max(500, Math.min(opts.timeoutMs ?? 8000, 60_000));
  const userAgent = opts.userAgent?.trim() || DEFAULT_USER_AGENT;
  // Default to en-US. Accept BCP-47 tags like "zh-CN", "ja-JP", "en-GB".
  const locale = (opts.locale ?? "en-US").trim() || "en-US";
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "No global `fetch` available. Pass `fetchImpl` explicitly (Node 18+ ships one by default)."
    );
  }
  const engineRaw = (opts.engine ?? "auto").toLowerCase();
  if (engineRaw !== "auto" && !ENGINE_IDS.includes(engineRaw as SearchEngineId)) {
    throw new Error(
      `Unknown engine "${opts.engine}". Valid: auto, ${ENGINE_IDS.join(", ")}`
    );
  }
  return {
    num,
    recency_days,
    timeoutMs,
    userAgent,
    locale,
    fetchImpl,
    engine: engineRaw as SearchEngineId | "auto",
  };
}

/**
 * Run a search. Throws only on programming errors (bad options, no fetch).
 * Network / parse failures are surfaced via the returned `SearchOutcome`
 * — either `{success: true, ...}` or `{success: false, error, errors?}`.
 */
export async function search(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchOutcome> {
  const resolved = resolveOptions(opts);
  const startedAt = Date.now();

  if (!query || !query.trim()) {
    return {
      success: false,
      error: "Query is empty.",
      elapsedMs: Date.now() - startedAt,
    };
  }

  const callEngine = (id: SearchEngineId) =>
    ENGINES[id].search(query, {
      num: resolved.num,
      recency_days: resolved.recency_days,
      timeoutMs: resolved.timeoutMs,
      userAgent: resolved.userAgent,
      locale: resolved.locale,
      fetchImpl: resolved.fetchImpl as typeof fetch,
    });

  // ---- Explicit single-engine mode ----
  if (resolved.engine !== "auto") {
    try {
      const results = await callEngine(resolved.engine);
      return {
        success: true,
        results,
        engine: resolved.engine,
        enginesTried: [resolved.engine],
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  // ---- Auto mode: try engines in order, return first non-empty ----
  const tried: SearchEngineId[] = [];
  const errors: Array<{ engine: SearchEngineId; error: unknown }> = [];

  for (const id of AUTO_ENGINE_ORDER) {
    tried.push(id);
    try {
      const results = await callEngine(id);
      if (results.length > 0) {
        return {
          success: true,
          results,
          engine: id,
          enginesTried: tried,
          elapsedMs: Date.now() - startedAt,
        };
      }
      errors.push({ engine: id, error: new Error("Engine returned 0 results") });
    } catch (err) {
      errors.push({ engine: id, error: err });
      // continue to next engine
    }
  }

  const agg = new AllEnginesFailedError(errors);
  return {
    success: false,
    error: agg.message,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Throw-on-failure variant. Equivalent to `search()` but throws
 * `AllEnginesFailedError` (in `auto` mode) or the underlying engine
 * error (in single mode). Handy when you'd rather use try/catch than
 * branch on `success`.
 */
export async function searchOrThrow(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchFunctionResultItem[]> {
  const outcome = await search(query, opts);
  if (!outcome.success) {
    if ("errors" in outcome && outcome.errors && outcome.errors.length > 1) {
      throw new AllEnginesFailedError(outcome.errors);
    }
    throw new Error(outcome.error);
  }
  return outcome.results;
}
