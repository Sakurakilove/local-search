/**
 * Shared helpers used by every engine backend.
 *
 * No Z.AI / cloud SDK dependency — only Node's built-in `fetch` (Node 18+)
 * and a couple of small utilities. `cheerio` is loaded lazily so that
 * environments without it still get a clean import graph for the SDK
 * types.
 */
import type { SearchFunctionResultItem, SearchEngineId } from "../types.js";

let cheerioPromise: Promise<typeof import("cheerio")> | null = null;

/** Lazy-load cheerio (keeps `import` cheap for callers who only need types). */
export async function loadCheerio(): Promise<typeof import("cheerio")> {
  if (!cheerioPromise) {
    cheerioPromise = import("cheerio").catch((err) => {
      throw new Error(
        "Required dependency 'cheerio' is not installed. Run `npm install cheerio` (or `bun add cheerio`)."
      );
    });
  }
  return cheerioPromise;
}

/** Default User-Agent — looks like a normal browser to most engines. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Standard browser-ish headers, override-able per call. */
export function defaultHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };
}

/** Tiny fetch-with-timeout wrapper. Aborts via `AbortController`. */
export async function fetchHtml(
  url: string,
  opts: {
    fetchImpl: typeof fetch;
    headers: Record<string, string>;
    timeoutMs: number;
    method?: "GET" | "POST";
    body?: string;
  }
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetchImpl(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    // `res.text()` will decode based on Content-Type charset; good enough for
    // the major search engines which all return utf-8.
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the host (registrable domain) from a URL string, defensively. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Fallback: crude host extraction. Useful when engines return URLs that
    // are not strictly valid (rare, but happens with DDG redirects).
    const m = url.match(/^https?:\/\/([^/]+)/i);
    return m ? m[1] : "";
  }
}

/** Build a Google S2-style favicon URL for a host. */
export function faviconForHost(host: string): string {
  if (!host) return "";
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
}

/** Strip HTML tags + collapse whitespace from a cheerio selection / string. */
export function cleanText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/\s+/g, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/** Build a `SearchFunctionResultItem` with all the cross-engine defaults filled in. */
export function makeItem(
  partial: Pick<
    SearchFunctionResultItem,
    "url" | "name" | "snippet" | "rank" | "source_engine"
  > & { raw_html?: string; date?: string }
): SearchFunctionResultItem {
  const host = hostOf(partial.url);
  return {
    url: partial.url,
    name: partial.name,
    snippet: partial.snippet,
    host_name: host,
    rank: partial.rank,
    date: partial.date ?? "N/A",
    favicon: faviconForHost(host),
    source_engine: partial.source_engine,
    raw_html: partial.raw_html,
  };
}

/** Convenience: assign a heuristic 0–100 score based on title/snippet length & rank. */
export function scoreItem(item: SearchFunctionResultItem, query: string): number {
  let score = 50;
  if (item.name && item.name.length > 10) score += 10;
  if (item.snippet && item.snippet.length > 50) score += 15;
  if (item.snippet && item.snippet.length > 150) score += 5;
  // Higher rank (== lower position) → small penalty.
  score -= Math.min(20, Math.max(0, item.rank - 1) * 2);
  // Bonus if the query appears in the title or snippet.
  const q = query.trim().toLowerCase();
  if (q) {
    const name = item.name.toLowerCase();
    const snip = item.snippet.toLowerCase();
    const terms = q.split(/\s+/).filter((t) => t.length > 1);
    let hits = 0;
    for (const t of terms) {
      if (name.includes(t) || snip.includes(t)) hits++;
    }
    score += Math.min(20, hits * 5);
  }
  return Math.max(0, Math.min(100, score));
}

/** Type guard for the engine id list. */
export const ENGINE_IDS: ReadonlyArray<SearchEngineId> = [
  "duckduckgo",
  "bing",
  "google",
];
