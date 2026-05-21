import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import requests

_ENDPOINT = "https://graphql.anilist.co"

_QUERY = """
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    title { romaji english native }
    genres
    averageScore
    episodes
    seasonYear
    status
    format
  }
}
"""

_SEASON_STRIP = re.compile(r"[\[【(].*?[\]】)]|\s+\d+期$|\s+Season\s+\d+$", re.IGNORECASE)


class RateLimiter:
    def __init__(self, rate: float = 1.0):
        self._lock = threading.Lock()
        self._interval = 1.0 / rate
        self._last = 0.0

    def acquire(self) -> None:
        with self._lock:
            wait = self._interval - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()


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


def _query_anilist(search: str, limiter: RateLimiter) -> dict | None:
    limiter.acquire()
    try:
        resp = requests.post(
            _ENDPOINT,
            json={"query": _QUERY, "variables": {"search": search}},
            timeout=10,
        )

        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            time.sleep(wait)
            limiter.acquire()
            resp = requests.post(
                _ENDPOINT,
                json={"query": _QUERY, "variables": {"search": search}},
                timeout=10,
            )

        if resp.status_code != 200:
            return None

        data = resp.json().get("data", {}).get("Media")
        if not data:
            return None

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
    except requests.RequestException:
        return None


def prefetch_all(
    show_names: list[str],
    cache: dict,
    cache_path: Path,
    limiter: RateLimiter,
    *,
    workers: int = 4,
    on_done: Callable[[str, dict | None, bool], None] | None = None,
) -> dict[str, dict | None]:
    """Fetch AniList metadata for all shows concurrently, respecting the rate limit."""
    cache_lock = threading.Lock()
    out: dict[str, dict | None] = {}

    def _fetch(name: str) -> tuple[str, dict | None]:
        key = name.lower().strip()

        with cache_lock:
            if key in cache:
                meta = cache[key]
                if on_done:
                    on_done(name, meta, True)
                return name, meta

        meta = _query_anilist(name, limiter)
        if meta is None:
            cleaned = _clean_name(name)
            if cleaned and cleaned.lower() != key:
                meta = _query_anilist(cleaned, limiter)

        with cache_lock:
            cache[key] = meta
            save_cache(cache, cache_path)

        if on_done:
            on_done(name, meta, False)
        return name, meta

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for name, meta in pool.map(_fetch, show_names):
            out[name] = meta

    return out
