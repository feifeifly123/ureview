"""SOCKS-safe HTTP fetch for outbound-network tools.

urllib honours HTTP_PROXY / HTTPS_PROXY but does NOT speak SOCKS.
Containers that only egress via SOCKS (e.g. `HTTPS_PROXY=socks5h://...`)
will see urllib fail with errors like "Remote end closed connection
without response" — urllib tries HTTP framing against the SOCKS proxy
and the proxy tears down the connection.

This module's `fetch()` / `fetch_text()` try urllib first and fall back
to curl (which speaks both HTTP and SOCKS). It's the one place every
outbound-HTTP tool in this repo should go through; see PHILOSOPHY.md §6
("all outbound-network tools must be SOCKS-safe").

Usage:
    from _netlib import fetch, fetch_text, FetchError

    # get bytes (for binary / XML / JSON where you parse yourself)
    raw = fetch("https://export.arxiv.org/api/query?id_list=2201.11903")

    # get decoded str (for HTML, text APIs)
    html = fetch_text("https://huggingface.co/papers", timeout=20)

    try:
        data = fetch(url)
    except urllib.error.HTTPError as e:
        # server returned a non-2xx — handle 404 / 500 distinctly
        ...
    except FetchError:
        # both urllib and curl failed (real network problem)
        ...
"""

from __future__ import annotations

import os
import shutil
import subprocess
import urllib.error
import urllib.request

DEFAULT_USER_AGENT = "openagent-review/1.0 (+https://openagent.review)"


class FetchError(RuntimeError):
    """Both urllib and curl failed (or curl isn't installed)."""


def fetch(
    url: str,
    *,
    timeout: int = 20,
    user_agent: str = DEFAULT_USER_AGENT,
    extra_headers: dict[str, str] | None = None,
) -> bytes:
    """Fetch a URL, returning raw bytes of the response body.

    Tries urllib first. On URLError / ConnectionResetError, falls back
    to curl (which speaks both HTTP and SOCKS proxies). urllib's
    HTTPError (server-level 4xx/5xx) is *not* treated as a fallback
    trigger — it bubbles up so the caller can react to 404/500 specifically.
    """
    headers = {"User-Agent": user_agent}
    if extra_headers:
        headers.update(extra_headers)

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError:
        raise  # server-side HTTP error (404, 500, …) — let caller handle
    except (urllib.error.URLError, ConnectionResetError) as urllib_err:
        return _curl_fallback(url, headers, timeout, urllib_err)


def fetch_text(
    url: str,
    *,
    timeout: int = 20,
    user_agent: str = DEFAULT_USER_AGENT,
    extra_headers: dict[str, str] | None = None,
    encoding: str = "utf-8",
) -> str:
    """Same as fetch() but decodes the response (default UTF-8, errors=replace)."""
    return fetch(url, timeout=timeout, user_agent=user_agent, extra_headers=extra_headers).decode(
        encoding, errors="replace"
    )


def _curl_fallback(url: str, headers: dict[str, str], timeout: int, urllib_err: Exception) -> bytes:
    if not shutil.which("curl"):
        raise FetchError(
            f"urllib failed ({urllib_err}) and curl is not on PATH to fall back to."
        ) from urllib_err

    curl_timeout = max(timeout * 2, 30)
    cmd = ["curl", "-sSL", "--max-time", str(curl_timeout)]
    for name, value in headers.items():
        cmd.extend(["-H", f"{name}: {value}"])
    proxy = os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
    if proxy:
        cmd.extend(["--proxy", proxy])
    cmd.append(url)

    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            timeout=curl_timeout + 5,
        )
    except subprocess.CalledProcessError as curl_err:
        raise FetchError(
            f"curl fallback failed (exit {curl_err.returncode}): "
            f"{curl_err.stderr.decode('utf-8', 'replace').strip()}"
        ) from curl_err
    except subprocess.TimeoutExpired as to_err:
        raise FetchError(f"curl fallback timed out after {to_err.timeout}s") from to_err
    return out.stdout
