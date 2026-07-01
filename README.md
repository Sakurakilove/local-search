# local-search

> **Languages**: [English](./README.md) · [简体中文](./README.zh-CN.md)

[![ClawHub](https://img.shields.io/badge/ClawHub-%40Sakurakilove%2Flocal--search-red?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6eiIvPjwvc3ZnPg==)](https://clawhub.ai/@Sakurakilove/local-search)
[![Version](https://img.shields.io/badge/version-1.2.1-blue)](https://github.com/Sakurakilove/local-search/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![GitHub stars](https://img.shields.io/github/stars/Sakurakilove/local-search?style=social)](https://github.com/Sakurakilove/local-search)
[![GitHub last commit](https://img.shields.io/github/last-commit/Sakurakilove/local-search)](https://github.com/Sakurakilove/local-search/commits/main)

Web search skill that runs entirely on the user's machine. Scrapes the public SERPs of **DuckDuckGo / Bing / Google** directly over HTTP, with automatic engine fallback when one backend is rate-limiting or unreachable.

Each result is a `SearchFunctionResultItem` with `url`, `name`, `snippet`, `host_name`, `rank`, `date`, `favicon`, plus three extension fields: `source_engine`, `raw_html`, `score`.

## Quick Start

```bash
# 1. install the one runtime dependency
cd local-search
npm install           # or: bun install

# 2. run the example
tsx scripts/web_search.ts

# 3. or use the CLI directly
tsx bin/web-search.ts "artificial intelligence" --num 5
tsx bin/web-search.ts "AI news" --recency-days 1 --json -o ai_news.json
```

## Why?

- **No API key** — calls the public search engines directly.
- **No network hop** — your machine → engine, nothing in between.
- **Transparent** — every result carries a `source_engine` field so you can see who answered.
- **Resilient** — if DDG is rate-limiting you, the orchestrator silently falls through to Bing, then Google.
- **Locale-aware** — `--locale en-US` / `zh-CN` / `ja-JP` / any BCP-47 tag. Critical for non-US IPs where Bing otherwise serves localized results even for English queries.

## Files

```
local-search/
├── SKILL.md             # full documentation (read this first)
├── package.json         # declares cheerio as the only runtime dep
├── tsconfig.json
├── LICENSE.txt
├── bin/
│   └── web-search.ts    # CLI: tsx bin/web-search.ts <query> [opts]
├── src/
│   ├── index.ts         # SDK exports
│   ├── search.ts        # orchestrator with auto-fallback
│   ├── types.ts         # SearchFunctionResultItem + options
│   └── engines/
│       ├── _shared.ts   # fetch/parse helpers
│       ├── duckduckgo.ts
│       ├── bing.ts
│       ├── google.ts
│       └── index.ts     # engine registry + AUTO_ENGINE_ORDER
└── scripts/
    └── web_search.ts    # quick-start example
```

## Programmatic Usage

```typescript
import { search } from "local-search";

const outcome = await search("What is the capital of France?", { num: 5 });
if (outcome.success) {
  console.log(`Engine: ${outcome.engine}  (${outcome.elapsedMs}ms)`);
  for (const item of outcome.results) {
    console.log(`- ${item.name}\n  ${item.url}\n  ${item.snippet}\n`);
  }
} else {
  console.error(outcome.error);
}
```

## CLI Usage

```bash
tsx bin/web-search.ts <query> [options]

Options:
  --num, -n <N>          Number of results (default: 10)
  --engine, -e <id>      duckduckgo | bing | google | auto  (default: auto)
  --recency-days, -r <N> Restrict to results from last N days
  --locale <BCP-47>      Result locale, e.g. en-US (default), zh-CN, ja-JP
  --timeout <ms>         Per-engine timeout (default: 8000)
  --json                  Emit JSON
  --output, -o <path>     Write JSON to file
  --quiet, -q             Suppress banner
  --help, -h              Show help
```

## Engines

| Engine | Endpoint | API key | Residential IP | Datacenter IP | Recency support |
|---|---|---|---|---|---|
| DuckDuckGo | `https://html.duckduckgo.com/html/` (GET) | none | high | medium (rate-limits under load) | `df=d<N>` (exact days) |
| Bing | `https://www.bing.com/search` | none | high | high | `freshness=d1\|w1\|m1` (bucketed) |
| Google | `https://www.google.com/search` | none | medium | low (enablejs wall) | `tbs=qdr:d\|w\|m\|y` (bucketed) |

`engine: "auto"` (the default) tries them in the order DuckDuckGo → Bing → Google, returning the first non-empty result set. From a datacenter IP, the effective chain is DDG → Bing (Google is usually blocked); from a residential IP, all three are viable.

The chain is configurable — edit `AUTO_ENGINE_ORDER` in `src/engines/index.ts`.

## Verify Your Install

After `npm install`, run the included e2e test to confirm everything works on your network:

```bash
tsx scripts/test.ts
```

Expected output: 8 tests pass. If your IP is being rate-limited by DDG, the test still passes because auto-mode falls through to Bing — Test 6 in the suite explicitly verifies this fallback path.

## Acknowledgements

The result schema and original skill structure were inspired by [`z-ai-web-dev-sdk`](https://www.npmjs.com/package/z-ai-web-dev-sdk)'s `web-search` skill. That project's MIT-licensed design shaped the `SearchFunctionResultItem` shape used here; all engine backend code in this package is original.

## License

MIT. See [`LICENSE.txt`](./LICENSE.txt).
