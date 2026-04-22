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

## 🔒 Iron rule: a mature site ships data, not code

Once openagent.review reaches steady state — design stable, review
schema frozen — the daily workflow is exactly **one command**:

```bash
pnpm refresh:data:prod
```

This rebuilds local indexes, validates the data against the schema,
and uploads the delta to R2. **It does not touch git. It does not
rebuild the site. It does not redeploy.**

This is a design constraint, not an accident. The site MUST NOT
develop build-time dependencies on specific reviews. Any future
feature that would require a site rebuild per new review is
**rejected by default**. When reviewing a proposal, ask:

> _Does this force a git push for every new review?_

If yes, find another way. Edge functions, client-side rendering,
schema-driven components — whatever — but never a build gate on the
review stream.

### Why this matters

- Updates scale with the author's typing speed, not with CI latency
- Zero risk of a data-layer change breaking the site
- A review filed Saturday 2 AM doesn't wait for a build pipeline
- No deploy pressure on review authorship

### What about share-preview (og:title, og:description)?

Listings on the home + browse pages link to `/review/?id={id}` —
the legacy client-fetch URL. That URL works for **any** review in R2,
regardless of when the site was last built. **Readers never hit a
404 just because a new review hasn't been baked into the site yet.**

As a separate optimization, the site also ships static SSG pages at
`/review/{id}/` for every review that was in the repo at build time.
Those pages carry prerendered `<title>` + `og:*` tags, so anyone who
shares a `/review/{id}/` URL (or was linked from a past site version
that used that URL) gets a rich social preview.

The tradeoff: links shared from the current listings (the `?id=`
form) show a generic share preview. If you want the rich preview for
recent reviews, run the optional site rebuild:

```bash
git add data/ && git commit -m "Refresh review snapshot" && git push
# Cloudflare Pages auto-builds in ~90 seconds
```

No schedule, no cron, no pressure. The iron rule still holds — the
rebuild is purely to upgrade share-preview quality for recent
reviews; the reviews themselves are already live on R2.

### Why we don't auto-rewrite missing SSG pages via `_redirects`

We tried. Cloudflare Pages processes **both** `_redirects` rewrites
(status 200) and redirects (status 301/302) **before** static asset
matching — contrary to their docs. So any `/review/:id/` pattern we
write in `_redirects` ends up hijacking the SSG pages too, erasing
the P0 benefit for reviews that DO have rich share previews. We
decided to keep listings on the `?id=` URL instead; it's simpler
and the iron rule stays bulletproof.

A future Pages Functions-based fallback (edge-level "serve static if
exists, else legacy") would let us have both. Not done yet; not
worth the complexity until review volume grows.

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
