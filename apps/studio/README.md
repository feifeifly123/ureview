# OpenAgent Studio

Authoring UI for writing structured paper reviews into
`data/reviews/*.json`. Binds `0.0.0.0:4311` so other machines on your LAN
can reach it; it has **no authentication**, so only run it on a trusted
network. Studio has no ability to push to R2 — publishing is CLI-only
via `tools/publish_r2.py`.

## What it does

One page, two panels:

1. **HF Trending** — click *Sync trending* to pull the current
   `huggingface.co/papers/trending` list (50 papers). Each row shows
   whether it's already been reviewed. Click a row (or type an arXiv
   ID in the input) to open the editor.
2. **Existing reviews** — list of every file under `data/reviews/`
   with its leaning, date, and ethics flag. Click to re-open in the
   editor.

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
# 1. If your host needs a SOCKS/HTTP proxy for Hugging Face or arXiv,
#    set one or both before launching:
#    export ALL_PROXY='socks5h://user:pass@host:port'   # fetch_hf.py curl fallback picks this up
#    export HTTPS_PROXY='http://...'                     # urllib picks this up

# 2. Start the server:
pnpm dev:studio

# → http://0.0.0.0:4311 is ready (reachable from any host on the LAN)
```

The server binds to `0.0.0.0` and has no authentication — anyone who can
reach the port can overwrite `data/reviews/*.json` and trigger HF/arXiv
fetches. Run it only on trusted networks. Studio cannot publish to R2;
to push data run `tools/publish_r2.py` from the CLI.

## Data flow

```
  ┌──────────────────────────────────┐
  │ Browser: http://<lan-host>:4311  │
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
  └──────────────┬───────────────────┘
                 │  writes
                 ▼
  ┌──────────────────────────────────┐
  │ data/reviews/{id}.json           │
  │ data/latest.json (rebuilt)       │
  │ data/daily/{date}.json (rebuilt) │
  └──────────────────────────────────┘

  Publishing to Cloudflare R2 is CLI-only:
  run `tools/publish_r2.py` (or `pnpm publish:data:stage` / `publish:data:prod`).
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

## Troubleshooting

- **"HF sync failed"**: make sure your host can reach
  `huggingface.co`. If you need a SOCKS5 proxy, set `ALL_PROXY=socks5h://...`
  — `fetch_hf.py` uses curl as a fallback that respects `ALL_PROXY`.
- **Save returns 422**: the schema validator caught a malformed
  field. The error message names the path. Fix the field in the form
  and save again.
- **HF endpoint structure changes**: `tools/fetch_hf.py` looks for a
  `data-target="DailyPapers"` mount with a JSON `data-props`
  attribute. If HF ships a redesign and that attribute disappears,
  the tool logs a clear error and fetch returns 502.

## What it intentionally is not

- **Not a publisher.** Studio cannot push to R2; that path has been
  removed. Publishing is CLI-only via `tools/publish_r2.py`, where the
  three-layer safety (dry-run → typed confirm → apply) lives.
- **Not a public app.** It binds `0.0.0.0` and has no auth. Anyone who
  can reach the port can overwrite reviews. Only run it on a trusted
  network.
- **Not an LLM caller.** Paste-only by design; the LLM step still
  happens in whatever tool you use (Claude, GPT, etc.).
- **Not a conflict resolver.** If two humans edit the same review
  concurrently the last save wins. Don't run two studios on the
  same repo simultaneously.
