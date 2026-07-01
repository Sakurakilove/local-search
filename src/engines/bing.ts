/**
 * Bing HTML backend.
 *
 * Endpoint: https://www.bing.com/search?q=<query>&count=<num>
 *
 * No API key required. Bing's HTML is relatively stable and easy to parse.
 * Add `&ensearch=1&setmkt=en-US&setlang=en-US` to force the en-US locale,
 * otherwise Bing may serve a localized variant based on the caller's IP
 * (which still parses, but titles/snippets may be non-English).
 *
 * Bing wraps outgoing URLs in a tracking redirector (`/ck/a?...&u=a1<base64>`).
 * We decode that base64 payload to recover the real destination URL.
 */
import type {
  SearchEngine,
  SearchFunctionResultItem,
} from "../types.js";
import { SearchEngineError } from "../types.js";
import {
  DEFAULT_USER_AGENT,
  cleanText,
  defaultHeaders,
  fetchHtml,
  loadCheerio,
  makeItem,
  scoreItem,
} from "./_shared.js";

export const bingEngine: SearchEngine = {
  id: "bing",
  display: "Bing (HTML)",
  async search(query, opts) {
    const { num, recency_days, timeoutMs, userAgent, locale, fetchImpl } = opts;

    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.max(num, 10)));
    // Locale forcing: from non-US IPs (notably China), Bing redirects to
    // cn.bing.com and serves localized results even when the query is
    // English. The combination `cc=<country>` + `mkt=<locale>` +
    // `setlang=<locale>` + `ensearch=1` + `form=QBLH` is what reliably
    // pins the SERP to the requested locale.
    // `cc` is the key parameter — it sets the country code which overrides
    // geo-IP localization.
    const localeNorm = locale.trim();
    const country = localeNorm.split("-")[1]?.toUpperCase() || "US";
    url.searchParams.set("cc", country);
    url.searchParams.set("mkt", localeNorm);
    url.searchParams.set("setlang", localeNorm);
    url.searchParams.set("ensearch", "1");
    url.searchParams.set("form", "QBLH");
    // Bing freshness filter: "d1" = past day, "w1" = past week, "m1" = past month.
    // Bing's URL API does not accept arbitrary N days; we fall back to
    // `w1`/`m1` buckets otherwise.
    if (recency_days && recency_days > 0) {
      if (recency_days <= 1) url.searchParams.set("freshness", "d1");
      else if (recency_days <= 7) url.searchParams.set("freshness", "w1");
      else url.searchParams.set("freshness", "m1");
    }

    let html: string;
    try {
      // Force Accept-Language to match the requested locale. This header
      // is the second-most-important locale signal after `cc`/`mkt` —
      // without it, Bing may still serve a localized page to match the
      // geo of the requester's IP.
      const headers = defaultHeaders(userAgent);
      headers["Accept-Language"] = `${localeNorm},${localeNorm.split("-")[0]};q=0.9,en;q=0.5`;
      html = await fetchHtml(url.toString(), {
        fetchImpl,
        headers,
        timeoutMs,
      });
    } catch (err) {
      throw new SearchEngineError("bing", `Request failed: ${(err as Error).message}`, err);
    }

    if (!html || html.length < 200) {
      throw new SearchEngineError("bing", "Empty or near-empty response body");
    }

    let results: SearchFunctionResultItem[];
    try {
      const cheerio = await loadCheerio();
      const $ = cheerio.load(html);
      const items: SearchFunctionResultItem[] = [];

      // Bing's main organic results live in `<li class="b_algo">`.
      $("li.b_algo").each((i, el) => {
        if (items.length >= num) return;
        const $el = $(el);

        const $link = $el.find("h2 a").first();
        const rawHref = $link.attr("href") || "";
        if (!rawHref) return;

        // Bing wraps outbound URLs in /ck/a?...&u=a1<base64>. Decode it.
        const realUrl = decodeBingRedirect(rawHref);
        if (!realUrl) return;

        const title = cleanText($link.text());
        if (!title) return;

        // Snippet: Bing keeps it under `.b_caption p` (sometimes `.b_lineclamp4`).
        const snippet = cleanText(
          $el.find(".b_caption p").text() ||
            $el.find(".b_lineclamp4").text() ||
            $el.find(".b_factrow").text()
        );

        const rawHtml = $el.find(".b_caption p").html() || "";

        const item = makeItem({
          url: realUrl,
          name: title,
          snippet,
          rank: i + 1,
          source_engine: "bing",
          raw_html: rawHtml || undefined,
        });

        // Bing sometimes embeds a publish date in `.news_dt`. Note: do NOT
        // pull from `.b_attribution cite` — that element contains the URL
        // breadcrumb (e.g. "en.wikipedia.org › wiki › Machine"), not a date.
        const dateText = cleanText($el.find(".news_dt").first().text());
        if (dateText && /\d{4}|hour|day|minute|ago/i.test(dateText)) {
          item.date = dateText;
        }

        item.score = scoreItem(item, query);
        items.push(item);
      });

      results = items;
    } catch (err) {
      throw new SearchEngineError("bing", `Parse failed: ${(err as Error).message}`, err);
    }

    if (results.length === 0) {
      throw new SearchEngineError("bing", "No results parsed (page may be blocked or rate-limited)");
    }
    return results;
  },
};

/**
 * Bing wraps outbound URLs in a tracking redirector:
 *   https://www.bing.com/ck/a?!&&p=...&u=a1<base64>&ntb=1
 *
 * The `u` parameter holds the real destination URL, base64-encoded with a
 * leading `a1` marker and using `_*` instead of `+/` (URL-safe variant).
 * Returns "" if the input doesn't look like a Bing redirect — in which
 * case callers should treat the raw href as the URL.
 */
function decodeBingRedirect(href: string): string {
  if (!href) return "";

  // Plain http(s) URL — already the real destination.
  if (/^https?:\/\//i.test(href) && !href.includes("bing.com/ck/a")) {
    return href;
  }

  try {
    const u = new URL(href, "https://www.bing.com/");
    if (!u.pathname.startsWith("/ck/a")) return "";
    const raw = u.searchParams.get("u");
    if (!raw) return "";

    // Strip the leading "a1" marker.
    const b64 = raw.startsWith("a1") ? raw.slice(2) : raw;
    // Bing uses URL-safe base64: replace _ with / and * with +.
    const std = b64.replace(/_/g, "/").replace(/\*/g, "+");
    // Pad to a multiple of 4.
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return "";
  } catch {
    return "";
  }
}

// Re-export for engine registry; not used here but kept for parity.
export const _defaultUserAgent = DEFAULT_USER_AGENT;
