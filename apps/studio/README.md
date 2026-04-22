# OpenAgent Studio

Authoring UI for writing structured paper reviews into
`data/reviews/*.json`. Binds `0.0.0.0:4311` so other machines on your LAN
can reach it; it has **no authentication**, so only run it on a trusted
network. Studio has no ability to push to R2 — publishing is CLI-only
via `tools/publish_r2.py`.

## What it does

One page, two panels:

1. **HF Daily** — click *Sync daily* to pull today's
   `huggingface.co/papers` Daily Papers (≈ 20 papers hand-picked by HF
   each day). Each row shows whether it's already been reviewed. Click
   a row (or type an arXiv ID in the input) to open the editor.
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

Studio spawns `tools/fetch_hf.py` and `tools/fetch_arxiv.py` as Python
subprocesses, so the shell environment it starts in must be able to
reach `huggingface.co` and `arxiv.org`. The subprocesses inherit the
parent env.

### Recommended: this container's SOCKS relay

In the Jupyter container this site lives in, the only egress that
reliably reaches `huggingface.co` is the internal relay at
`socks5h://net-relay:1080`. The default Claude Code HTTP proxy
(`http://121.4.45.119:31785`) is blocked by HF. Start Studio like this:

```bash
ALL_PROXY=socks5h://net-relay:1080 \
HTTPS_PROXY=socks5h://net-relay:1080 \
HTTP_PROXY=socks5h://net-relay:1080 \
pnpm dev:studio
```

Why three env vars instead of one? `fetch_hf.py` prefers `urllib`
(reads `HTTPS_PROXY`) and falls back to `curl` (reads `ALL_PROXY`).
`fetch_arxiv.py` is urllib-only. Setting all three covers both paths
and avoids surprise fallbacks.

Verify it worked:

```bash
curl -s http://127.0.0.1:4311/api/daily | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(f"{len(d)} papers")'
# Expect: ~20 papers (HF's daily curation size)
```

If that prints `50 papers` or similar, you're good. If it prints a
JSON error object with `{"error": "..."}`, the proxy didn't reach HF.

### Different host / different proxy

If you're not in this container, use whatever route reaches
`huggingface.co` from your machine. Common forms:

```bash
# no proxy needed (your host has direct egress)
pnpm dev:studio

# corporate HTTP proxy
HTTPS_PROXY='http://proxy.internal:8080' pnpm dev:studio

# SOCKS5 with auth
ALL_PROXY='socks5h://user:pass@host:port' pnpm dev:studio
```

### After it starts

```
[studio] http://0.0.0.0:4311 ready
```

Open in a browser, click **Sync daily**, confirm today's HF Daily
papers populate. Studio is now ready for authoring.

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
| `GET` | `/api/daily` | HF Daily papers (via fetch_hf.py --json-stdout) |
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
