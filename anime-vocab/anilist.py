import json
import re
import time
from pathlib import Path
from typing import Callable

import requests

_ENDPOINT = "https://graphql.anilist.co"

_MEDIA_FIELDS = """
    id
    title { romaji english native }
    genres
    averageScore
    episodes
    seasonYear
    status
    format
"""

_SEASON_STRIP = re.compile(r"[\[【(].*?[\]】)]|\s+\d+期$|\s+Season\s+\d+$", re.IGNORECASE)


def load_cache(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict, path: Path) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _clean_name(name: str) -> str:
    return _SEASON_STRIP.sub("", name).strip()


def _parse_media(data: dict) -> dict:
    title = data.get("title", {})
    return {
        "id": data["id"],
        "title_romaji": title.get("romaji"),
        "title_english": title.get("english"),
        "title_native": title.get("native"),
        "genres": data.get("genres", []),
        "score": data.get("averageScore"),
        "episodes": data.get("episodes"),
        "year": data.get("seasonYear"),
        "status": data.get("status"),
        "format": data.get("format"),
    }


def _do_request(payload: dict, retry_after_429: bool = True) -> requests.Response | None:
    try:
        resp = requests.post(_ENDPOINT, json=payload, timeout=15)
        if resp.status_code == 429 and retry_after_429:
            wait = int(resp.headers.get("Retry-After", 60))
            time.sleep(wait)
            resp = requests.post(_ENDPOINT, json=payload, timeout=15)
        return resp
    except requests.RequestException:
        return None


def _query_batch(searches: list[str]) -> dict[str, dict | None]:
    """Send one GraphQL request for multiple shows using aliases."""
    # Build aliased query: s0: Media(search: "...") { ... }
    aliases = [f's{i}: Media(search: {json.dumps(s)}, type: ANIME) {{ {_MEDIA_FIELDS} }}'
               for i, s in enumerate(searches)]
    query = "query {\n" + "\n".join(aliases) + "\n}"

    resp = _do_request({"query": query})
    if resp is None or resp.status_code != 200:
        return {s: None for s in searches}

    data = resp.json().get("data") or {}
    results: dict[str, dict | None] = {}
    for i, search in enumerate(searches):
        raw = data.get(f"s{i}")
        results[search] = _parse_media(raw) if raw else None
    return results


def prefetch_all(
    show_names: list[str],
    cache: dict,
    cache_path: Path,
    *,
    batch_size: int = 50,
    rate: float = 1.0,
    on_done: Callable[[str, dict | None, bool], None] | None = None,
) -> dict[str, dict | None]:
    """Fetch AniList metadata for all shows, batching multiple shows per request."""
    out: dict[str, dict | None] = {}
    interval = 1.0 / rate

    # Separate cache hits from shows that need fetching
    uncached: list[str] = []
    for name in show_names:
        key = name.lower().strip()
        if key in cache:
            out[name] = cache[key]
            if on_done:
                on_done(name, cache[key], True)
        else:
            uncached.append(name)

    # Process uncached shows in batches
    for batch_start in range(0, len(uncached), batch_size):
        batch = uncached[batch_start: batch_start + batch_size]
        t0 = time.time()

        results = _query_batch(batch)

        # For any that came back None, retry once with cleaned name
        retries: list[str] = []
        retry_originals: dict[str, str] = {}
        for name, meta in results.items():
            if meta is None:
                cleaned = _clean_name(name)
                if cleaned and cleaned.lower() != name.lower().strip():
                    retries.append(cleaned)
                    retry_originals[cleaned] = name

        if retries:
            # Wait out the rate limit before retry batch
            elapsed = time.time() - t0
            if elapsed < interval:
                time.sleep(interval - elapsed)
            t0 = time.time()
            retry_results = _query_batch(retries)
            for cleaned, meta in retry_results.items():
                original = retry_originals[cleaned]
                if meta is not None:
                    results[original] = meta

        # Store results
        for name, meta in results.items():
            key = name.lower().strip()
            cache[key] = meta
            out[name] = meta
            if on_done:
                on_done(name, meta, False)

        save_cache(cache, cache_path)

        # Rate limit between batches
        elapsed = time.time() - t0
        if elapsed < interval and batch_start + batch_size < len(uncached):
            time.sleep(interval - elapsed)

    return out
