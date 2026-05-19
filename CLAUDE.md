# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

Before touching anything non-trivial:

- **`README.md`** — architecture (site ↔ R2), three iron rules, command cheat sheet
- **`PHILOSOPHY.md`** — product north star. **Partially out of date** — sections that reference four-dimension ratings, recommendation, ethics flag, leaning, or `ai_review.*` describe a schema that was pivoted away. The current schema is below.
- **`apps/studio/README.md`** — authoring tool token gate + KaTeX preview

## Current state (post-pivot, 2026-05)

The site is **arxiv math papers only**, ranked by a single derived score `E[impact] = impact_if_true × proof_correctness`. Both axes are 5-tier enums:

```
max > high > medium > low > minimal
```

Numeric proxies used only for ranking: impact `9/7/5/3/1`, correctness `0.95/0.80/0.55/0.25/0.05`.

The only human-written field in a review is `ai_proof_review` (markdown + LaTeX). Everything else is arxiv passthrough. See `contracts/review.schema.json` for the authoritative shape; `apps/web/src/lib/types.ts` mirrors it in TypeScript and defines `expectedImpact()`, `impactMeta()`, `correctnessMeta()`, `categoryName()`, and the canonical `ARXIV_MATH_CATEGORIES` map (all 32 math.* subjects).

The `data/reviews/*.json` set is currently **mock** — ~10 hand-written placeholders covering the four quadrants (top / dragons / solid / rest). To be replaced when the real LLM scoring pipeline lands.

## Commands

```bash
pnpm dev                # site (Astro :4321) + data proxy (:7001), concurrently
pnpm dev:studio         # studio at :4311 (prints login token banner; 12h session)
pnpm build:web          # static build → apps/web/dist/
pnpm check:data         # validate data/reviews/*.json + latest.json vs schema
pnpm build:indexes      # regenerate data/latest.json (sorts by E[impact] desc)
pnpm refresh:data:prod  # build_indexes → validate → publish to R2 (--prod)
```

No test suite (yet). Verification is build + schema validation + manual browser pass.

## Iron rules (terse pointers to README)

1. **Mature site ships data, not code** — adding a review must not require a `git push`. Data goes to R2 via `pnpm refresh:data:prod`; site rebuild only for code changes.
2. **Public site is a pure static deploy** — no Cloudflare Functions / SSR / edge middleware. `apps/web/dist/` is 100% static.
3. **Outbound-network tools must be SOCKS-safe** — `tools/fetch_*.py` must go through `tools/_netlib.py` (urllib → curl fallback). Never call `urllib.request.urlopen` directly.

Full text + rationale in `README.md`.

## Architecture in one line

`apps/web` (SSG Astro, static) reads `data.openagent.review/data/latest.json` from R2 at runtime → renders feed / browse / review pages. `apps/studio` (vanilla SPA + Node http server) writes reviews to `data/reviews/*.json` locally. **No coupling between layers.**

Review detail pages are SSG (one HTML per review id, inline `window.__OAR_REVIEW` prebake — zero client fetch). Home + browse fetch `latest.json` client-side.

## Critical files

- `apps/web/src/lib/types.ts` — `Tier`, schemas, helpers, category map
- `apps/web/src/lib/feed-card.ts` — single feed card (score badge + kicker + lede)
- `apps/web/src/lib/review-page.ts` — detail-page renderer (scorecard + abstract + AI proof review + post-nav)
- `apps/web/src/pages/{index,browse,review,review/[...id],about}.astro` — routes
- `apps/web/src/styles/global.css` — design tokens (`--ochre`, `--ink`, `--paper`, etc.) + tier colors via `--tier-{max,high,medium,low,minimal}` (day/night override)
- `apps/studio/server.mjs` — token gate, session cookie, `/api/*` routes, KaTeX static proxy
- `apps/studio/public/main.js` — vanilla SPA (login view + dashboard + editor + markdown preview)
- `tools/_netlib.py` — SOCKS-safe HTTP (iron rule 3 anchor)
- `tools/build_indexes.py`, `tools/validate_data.py`, `tools/publish_r2.py` — data pipeline
- `contracts/review.schema.json`, `contracts/latest.schema.json` — authoritative shapes

## Studio (authoring tool) specifics

- LAN bind `0.0.0.0:4311`, gated by a single shared token printed at startup
- Pin token via `STUDIO_TOKEN` env; otherwise fresh per process
- 5-failure lockout for 5 minutes per IP; HttpOnly + SameSite=Strict cookie
- KaTeX served at `/static/katex/*` proxied from `apps/web/node_modules/katex/dist`
- Chapter II (the `ai_proof_review` textarea) has 👁 Preview / ✎ Edit toggle — uses the same prose rules as the public site (`##` → h3, `###` → h4, `$..$` inline, `$$..$$` display)

## Known traps

1. **CSS minifier corrupts long compound selectors with `:root[data-theme="night"]` prefixes.** When defining theme-dependent colors, use CSS variables (see `--tier-max` etc. in `global.css`). Do not rely on multi-selector rules to carry the `:root[...]` prefix through minification.

2. **Astro JSX-style brace eats literal `{` `}` in templates.** Use `&#123;` / `&#125;` for math/set notation in `.astro` files. (See about page quadrant definitions.)

3. **R2 latest.json and committed code can drift.** Push the site → if R2 is on an older schema, home/browse will throw on missing fields. Either push schema changes alongside `pnpm refresh:data:prod`, or accept the temporary break window.

4. **`/review/?id=X` is legacy** — kept as client-side redirect to the SSG `/review/{id}/` for share-link compatibility (see README iron rule #2 "Share-preview status at a glance").

5. **JupyterHub proxy prefix.** `Layout.astro` rewrites internal `/` hrefs to include `/user/<u>/proxy/<port>/` when accessed under that prefix. Keep all internal links absolute-from-root and let the rewriter handle it; don't hard-code the prefix anywhere.

## Git push

Direct GitHub TLS times out from this machine. **The only allowed proxy is `socks5h://s5_7y6n1d:csgtkhywdqCv3M3lRa@47.178.47.104:1080`**. If it fails ("connection closed" / timeout), **stop and ask the user** — do not fall back to other proxies. (User-mandated rule, 2026-05-18.)

```bash
ALL_PROXY='socks5h://s5_7y6n1d:csgtkhywdqCv3M3lRa@47.178.47.104:1080' \
http_proxy='socks5h://s5_7y6n1d:csgtkhywdqCv3M3lRa@47.178.47.104:1080' \
https_proxy='socks5h://s5_7y6n1d:csgtkhywdqCv3M3lRa@47.178.47.104:1080' \
git push origin main
```

## Browser testing (no chrome in standard path)

Headless screenshots: `/home/chenkang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/.local-browsers/chromium-1217/chrome-linux64/chrome` (Google Chrome for Testing 147). Useful for visual regression. The `chrome-devtools-mcp` plugin can't auto-find Chrome in this env — use the binary above with `--headless --disable-gpu --no-sandbox --screenshot=...`.
