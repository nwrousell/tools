import json
import re
import time
from pathlib import Path

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


def _query_anilist(search: str, last_req: list[float]) -> dict | None:
    elapsed = time.time() - last_req[0]
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)

    try:
        resp = requests.post(
            _ENDPOINT,
            json={"query": _QUERY, "variables": {"search": search}},
            timeout=10,
        )
        last_req[0] = time.time()

        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            time.sleep(wait)
            resp = requests.post(
                _ENDPOINT,
                json={"query": _QUERY, "variables": {"search": search}},
                timeout=10,
            )
            last_req[0] = time.time()

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


def fetch_metadata(
    folder_name: str,
    cache: dict,
    cache_path: Path,
    last_req: list[float],
) -> dict | None:
    key = folder_name.lower().strip()
    if key in cache:
        return cache[key]

    result = _query_anilist(folder_name, last_req)

    # retry with cleaned name if no match
    if result is None:
        cleaned = _clean_name(folder_name)
        if cleaned and cleaned.lower() != key:
            result = _query_anilist(cleaned, last_req)

    cache[key] = result
    save_cache(cache, cache_path)
    return result
