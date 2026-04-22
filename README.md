# openagent.review

A paper-triage surface: when an arXiv paper trends on Hugging Face, we
file one structured AI review and publish it. No editorial calendar,
no daily quota, no opinion about the site itself.

- **Public site**: [openagent.review](https://openagent.review/)
- **Product north star**: [`PHILOSOPHY.md`](./PHILOSOPHY.md)
- **Authoring tool**: [`apps/studio/README.md`](./apps/studio/README.md)

## Architecture in 60 seconds

Two independent layers, **never coupled**:

```
┌─ reader ─────────────────────────────────────────────────────┐
│                                                              │
│  openagent.review         ← site:  HTML/CSS/JS (Astro)       │
│        │                          built from apps/web/,      │
│        │                          deployed via Cloudflare    │
│        │  fetch                   Pages on git push          │
│        ▼                                                     │
│  data.openagent.review    ← data:  reviews/*.json,           │
│                                    latest.json,              │
│                                    daily/*.json              │
│                                    hosted on Cloudflare R2   │
└──────────────────────────────────────────────────────────────┘
```

The site fetches data at request time. **Deploying new data does not
require rebuilding the site.**

## 🔒 Iron rule #1: a mature site ships data, not code

Once openagent.review reaches steady state — design stable, review
schema frozen — the daily workflow is exactly **one command**:

```bash
pnpm refresh:data:prod
```

This rebuilds local indexes, validates the data against the schema,
and uploads the delta to R2. **It does not touch git. It does not
rebuild the site. It does not redeploy.**

The site MUST NOT develop build-time dependencies on specific
reviews. Any proposal that would require a site rebuild per new
review is **rejected by default**. When reviewing a proposal, ask:

> _Does this force a git push for every new review?_

If yes, find another way. Client-side rendering, schema-driven
components, different URL schemes — whatever — but never a build
gate on the review stream.

**Why this matters**:
- Updates scale with the author's typing speed, not with CI latency
- Zero risk of a data-layer change breaking the site
- A review filed Saturday 2 AM doesn't wait for a build pipeline
- No deploy pressure on review authorship

## 🔒 Iron rule #2: the public site is a pure static deploy

The `apps/web/` build output is **100% static assets** — HTML, CSS,
JS, fonts. Nothing executes at request time on our infrastructure.

This explicitly rules out:

- **Cloudflare Pages Functions / Workers** in front of the public site
- **Edge middleware** (`_middleware.ts` etc.) that runs per request
- **SSR / on-demand rendering** of any page
- **Any server code** that reads R2, transforms HTML, injects data,
  rewrites paths, or otherwise behaves dynamically per request

The only compute in the public path is the CDN itself (caching +
TLS) and the reader's browser (client-side rendering). The data
layer is also static: `data.openagent.review` serves pre-generated
JSON files from R2, not a query engine.

**Why this matters**:
- A pure static site has essentially no moving parts to break
- No function quotas, no cold-start latency, no edge-runtime
  version drift
- Cost scales only with traffic, not with invocation counts
- Every page is trivially reproducible from repo + R2 JSON — no
  opaque runtime state anywhere
- Debuggable with `curl` and `view-source:`, every single time

**Consequences this rule accepts**:

- Share previews for listing URLs (`/review/?id={id}`) stay generic.
  Social crawlers don't run JS and can't see the real title. Rich
  previews only appear for the SSG pages at `/review/{id}/`, which
  exist for reviews present in the repo at the last site build.
- There is no fallback that makes missing SSG pages render per-paper
  share meta on the fly. Reviews added to R2 since the last build
  still load (listings use the client-fetch URL), but their shared
  previews fall back to generic.
- If we want richer share previews for recent reviews, we run an
  occasional manual site rebuild (`git push`); the reviews
  themselves have been live on R2 the whole time.

If someone later wants to add edge compute, the question is not
"is this useful?" (it might be), it's **"does this break Iron rule
#2?"** Changing this rule requires writing up why — in this README,
with the reason and the new regime — not quietly adding a Function
file.

### Share-preview status at a glance

| URL shape | Who uses it | Preview quality |
|---|---|---|
| `/review/?id={id}` | home/browse listings; 95% of traffic | Generic site title |
| `/review/{id}/` | direct links, old shares, post-rebuild | Real paper title + og tags |

### Why we don't auto-rewrite missing SSG via `_redirects`

We tried. Cloudflare Pages processes **both** `_redirects` rewrites
(status 200) and redirects (status 301/302) **before** static asset
matching — contrary to their docs. Any `/review/:id/` pattern in
`_redirects` hijacks the SSG pages too, erasing the rich-preview
benefit for reviews that already have it. So we removed
`_redirects` and kept listings on the `?id=` URL. Simpler, and
Iron rule #1 stays bulletproof without violating Iron rule #2.

## 🔒 Iron rule #3: outbound-network tools must be SOCKS-safe

Any script in `tools/` that sends HTTP (fetching HF, arXiv, future
OpenReview, DOI, etc.) **must** go through `tools/_netlib.py`. Never
call `urllib.request.urlopen` directly.

**Why**: Python's urllib honours `HTTP_PROXY` / `HTTPS_PROXY` but
doesn't speak SOCKS. This container egresses via `socks5h://net-relay:1080`
for parts of the public internet (notably Hugging Face). When urllib
gets `HTTPS_PROXY=socks5h://...` it tries HTTP framing against a SOCKS
proxy and fails with `Remote end closed connection without response`.
`_netlib.fetch()` transparently falls back to `curl` (which speaks
both HTTP and SOCKS), so the same tool works in every environment.

### Template for new `tools/fetch_*.py`

```python
#!/usr/bin/env python3
import sys
from pathlib import Path

# tools/ dir on sys.path so _netlib resolves from a direct script or module run
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _netlib import fetch_text, fetch, FetchError

# fetch_text → decoded str; fetch → raw bytes
html = fetch_text("https://your-source.com/endpoint", timeout=20)
```

That's it. Don't reimplement the urllib → curl fallback by hand; we
centralised it precisely so `fetch_hf.py`, `fetch_arxiv.py`, and
whatever comes next share one correct path. When reviewing a new
`fetch_*` tool, the first check is: **does it import from
`_netlib`?**

See `PHILOSOPHY.md` §6 for the formal statement.

## Daily workflow (mature state)

```bash
# 1. Add review
#    - via Studio UI:  pnpm dev:studio  →  http://0.0.0.0:4311
#    - or write data/reviews/{YYYY-MM-DD-slug}.json by hand

# 2. Publish (one command covers everything)
pnpm refresh:data:prod
#    ├── tools/build_indexes.py      (rebuild latest.json + daily/*)
#    ├── tools/validate_data.py      (schema check)
#    └── tools/publish_r2.py --prod  (upload delta to R2, typed
#                                     confirmation before real write)

# 3. Done. openagent.review now serves the new review. No git, no rebuild.
```

## Emergency: I need to change site code

When the actual site needs a fix (CSS bug, copy change, new feature,
new schema field, new component):

```bash
# develop + test locally
pnpm dev                      # site + data proxy on :4321 and :7001
# or
pnpm build:web && cd apps/web/dist && python3 -m http.server 4322
# confirms production build behaves correctly

# ship
git commit -am "Web: <what changed>"
git push
# Cloudflare Pages picks up the push and rebuilds in ~90 seconds
```

Site code changes are expected to be **rare** once the design settles.
The norm is the data workflow above.

## Operational surfaces

| I want to… | Command | Affects |
|---|---|---|
| Publish new review data | `pnpm refresh:data:prod` | R2 only |
| Stage data to a test bucket | `pnpm publish:data:stage` | R2 stage |
| Run the authoring UI | `pnpm dev:studio` | Local only, 127.0.0.1:4311 (or 0.0.0.0 if configured) |
| Hack on the site | `pnpm dev` | Local, 127.0.0.1:4321 |
| Test the production build | `pnpm build:web` | Writes `apps/web/dist/` |
| Validate review JSONs | `pnpm check:data` | Local filesystem only |
| Deploy site code | `git push` | triggers Cloudflare Pages build |

## See also

- [`PHILOSOPHY.md`](./PHILOSOPHY.md) — product design north star, the "why" behind every decision
- [`apps/studio/README.md`](./apps/studio/README.md) — local authoring tool for writing reviews
- [`contracts/*.schema.json`](./contracts/) — review JSON schemas (latest, review, daily)
- [`tools/publish_r2.py`](./tools/publish_r2.py) — the R2 publisher with its three safety layers
