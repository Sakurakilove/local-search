/**
 * Shared helpers used by every engine backend.
 *
 * Only Node's built-in `fetch` (Node 18+) and a couple of small utilities.
 * `cheerio` is loaded lazily so that environments without it still get a
 * clean import graph for the SDK types.
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

/**
 * Heuristic language detection from a query string.
 * Returns a BCP-47 locale tag.
 *
 * Uses Unicode block ranges to detect the dominant script:
 * - CJK Unified Ideographs → "zh-CN" (covers Chinese; JP/KR queries usually
 *   also contain kana/hangul which we check first)
 * - Hiragana / Katakana → "ja-JP"
 * - Hangul → "ko-KR"
 * - Cyrillic → "ru-RU"
 * - Arabic → "ar-SA"
 * - Thai → "th-TH"
 * - Hebrew → "he-IL"
 * - Greek → "el-GR"
 * - Default (Latin / mixed / empty) → "en-US"
 *
 * This is intentionally simple — we only need to pick a reasonable locale
 * for the search engine, not do real NLP. If the user explicitly passes
 * `locale` in SearchOptions, that always wins (see `resolveOptions`).
 */
export function detectLocale(query: string): string {
  if (!query) return "en-US";
  // Tally characters per script.
  const counts = { cjk: 0, hira: 0, kata: 0, hangul: 0, cyrillic: 0, arabic: 0, thai: 0, hebrew: 0, greek: 0, latin: 0 };
  for (const ch of query) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x3040 && cp <= 0x309f) counts.hira++;
    else if (cp >= 0x30a0 && cp <= 0x30ff) counts.kata++;
    else if (cp >= 0xac00 && cp <= 0xd7af) counts.hangul++;
    else if (cp >= 0x4e00 && cp <= 0x9fff) counts.cjk++;
    else if (cp >= 0x0400 && cp <= 0x04ff) counts.cyrillic++;
    else if (cp >= 0x0600 && cp <= 0x06ff) counts.arabic++;
    else if (cp >= 0x0e00 && cp <= 0x0e7f) counts.thai++;
    else if (cp >= 0x0590 && cp <= 0x05ff) counts.hebrew++;
    else if (cp >= 0x0370 && cp <= 0x03ff) counts.greek++;
    else if (cp >= 0x0041 && cp <= 0x024f) counts.latin++;
  }
  // Japanese and Korean have unique scripts (kana, hangul) that Chinese
  // doesn't. They usually appear alongside CJK ideographs (because both
  // languages use kanji/hanja to varying degrees), so we check them FIRST
  // — even a single kana/hangul character means it's Japanese/Korean,
  // regardless of how many CJK ideographs there are.
  if (counts.hira > 0 || counts.kata > 0) return "ja-JP";
  if (counts.hangul > 0) return "ko-KR";
  // No kana/hangul → CJK ideographs mean Chinese (or rarer CJK-using
  // languages; we default to zh-CN as that's by far the most common).
  if (counts.cjk > 0) return "zh-CN";
  if (counts.cyrillic > 0) return "ru-RU";
  if (counts.arabic > 0) return "ar-SA";
  if (counts.thai > 0) return "th-TH";
  if (counts.hebrew > 0) return "he-IL";
  if (counts.greek > 0) return "el-GR";
  return "en-US";
}

/**
 * Returns true if a result item is obviously irrelevant and should be dropped:
 * - URL points back into a search engine's own domain (search redirect, "did
 *   you mean" page, etc.)
 * - Title is empty / pure whitespace / identical to the query (suggests a
 *   "search suggestion" entry, not a real result)
 *
 * This is a defensive filter; engines should already not return such items,
 * but layouts drift and this catches the worst offenders.
 */
export function isLikelyIrrelevant(item: SearchFunctionResultItem, query: string): boolean {
  const url = item.url.toLowerCase();
  const name = (item.name || "").trim();
  if (!name) return true;
  if (name.toLowerCase() === query.trim().toLowerCase()) return true;
  // Self-referential search-engine domains — never a real result.
  if (/bing\.com\/(?:ck\/a|a\.|search|form=)/i.test(url)) return true;
  if (/duckduckgo\.com\/(?:y\.js|ad|spice|lite)/i.test(url)) return true;
  if (/google\.com\/(?:url\?|search|maps|calendar)/i.test(url)) return true;
  if (/search\.yahoo\.com|baidu\.com\/(?:s|link)/i.test(url)) return true;
  return false;
}

/** Type guard for the engine id list. */
export const ENGINE_IDS: ReadonlyArray<SearchEngineId> = [
  "duckduckgo",
  "bing",
  "google",
];
