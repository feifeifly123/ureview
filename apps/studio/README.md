# OpenAgent Studio

Local-only authoring UI for writing structured paper reviews into
`data/reviews/*.json`. Not deployed, not exposed to the internet. Runs
on `http://127.0.0.1:4311` only.

## What it does

One page, three panels:

1. **HF Trending** — click *Sync trending* to pull the current
   `huggingface.co/papers/trending` list (50 papers). Each row shows
   whether it's already been reviewed. Click a row (or type an arXiv
   ID in the input) to open the editor.
2. **Existing reviews** — list of every file under `data/reviews/`
   with its leaning, date, and ethics flag. Click to re-open in the
   editor.
3. **Publish to R2** — runs `tools/publish_r2.py --prod --dry-run`,
   shows the plan, requires typing the word `publish` before
   executing the real upload.

The editor has three blocks:

- **Block A — arXiv metadata** (auto-filled from arXiv API):
  title, abstract, paper_url, categories, optional HF rank.
- **Block B — Paste LLM output**: a textarea where you paste the
  JSON the LLM returns. Clicking *Parse & fill* populates Block C.
- **Block C — Structured fields**: summary, strengths & weaknesses,
  four dimension ratings (score + note each), key questions (list),
  limitations, recommendation, confidence, ethics flag/concerns,
  feed highlights (why_read / why_doubt / leaning).

## Run

```bash
# 1. From repo root, source your R2 creds only if you'll publish from the UI:
set -a && source .env.local && set +a

# 2. If your host needs a SOCKS/HTTP proxy for Hugging Face or arXiv,
#    set one or both before launching:
#    export ALL_PROXY='socks5h://user:pass@host:port'   # fetch_hf.py curl fallback picks this up
#    export HTTPS_PROXY='http://...'                     # urllib picks this up

# 3. Start the server:
pnpm dev:studio

# → http://127.0.0.1:4311 is ready
```

The server binds to `127.0.0.1`, never `0.0.0.0`. It is not suitable
for remote exposure and has no authentication.

## Data flow

```
  ┌──────────────────────────────────┐
  │ Browser: http://127.0.0.1:4311   │
  └──────────────┬───────────────────┘
                 │  fetch()
                 ▼
  ┌──────────────────────────────────┐
  │ apps/studio/server.mjs (Node)    │
  │                                  │
  │ spawns python3 subprocess for:   │
  │   • tools/fetch_hf.py            │
  │   • tools/fetch_arxiv.py         │
  │   • tools/validate_data.py       │
  │   • tools/build_indexes.py       │
  │   • tools/publish_r2.py          │
  └──────────────┬───────────────────┘
                 │  writes
                 ▼
  ┌──────────────────────────────────┐
  │ data/reviews/{id}.json            │
  │ data/latest.json (rebuilt)       │
  │ data/daily/{date}.json (rebuilt) │
  └──────────────┬───────────────────┘
                 │  publish_r2.py --prod --force
                 ▼
           Cloudflare R2
  (= openagent.review data source)
```

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | SPA shell (index.html) |
| `GET` | `/static/*` | assets |
| `GET` | `/api/reviews` | list of existing reviews (metadata only) |
| `GET` | `/api/review/:id` | one review JSON verbatim |
| `POST` | `/api/reviews` | body = full review JSON; validates + writes + reindexes |
| `GET` | `/api/trending` | HF trending (via fetch_hf.py --json-stdout) |
| `GET` | `/api/arxiv?id=` | arXiv metadata (via fetch_arxiv.py --id) |
| `POST` | `/api/publish/plan` | dry-run R2 plan |
| `POST` | `/api/publish/apply` | `{ "confirm": "publish" }` required in body |

## Troubleshooting

- **"HF sync failed"**: make sure your host can reach
  `huggingface.co`. If you need a SOCKS5 proxy, set `ALL_PROXY=socks5h://...`
  — `fetch_hf.py` uses curl as a fallback that respects `ALL_PROXY`.
- **"Missing environment variable: R2_ACCOUNT_ID"**: you need to
  `source .env.local` in the terminal that launched the server
  *before* `pnpm dev:studio`, so the python subprocesses inherit the
  creds.
- **Save returns 422**: the schema validator caught a malformed
  field. The error message names the path. Fix the field in the form
  and save again.
- **HF endpoint structure changes**: `tools/fetch_hf.py` looks for a
  `data-target="DailyPapers"` mount with a JSON `data-props`
  attribute. If HF ships a redesign and that attribute disappears,
  the tool logs a clear error and fetch returns 502.

## What it intentionally is not

- **Not a public app.** If the binding ever switches to `0.0.0.0`,
  anyone on your network can overwrite reviews and publish to R2.
  Don't do that.
- **Not an LLM caller.** Paste-only by design; the LLM step still
  happens in whatever tool you use (Claude, GPT, etc.).
- **Not a conflict resolver.** If two humans edit the same review
  concurrently the last save wins. Don't run two studios on the
  same repo simultaneously.
