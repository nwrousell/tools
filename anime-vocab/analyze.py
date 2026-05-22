#!/usr/bin/env python3
import argparse
import csv
import time
from itertools import islice
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.table import Table

import tempfile
import urllib.parse

import requests

import anilist
import subtitles
import tokenizer

console = Console()

DEFAULT_TOP_K = [100, 500, 1000, 2000, 3000, 5000]
DEFAULT_DATA_DIR = Path(__file__).parent / "data" / "subtitles" / "anime_tv"

_STATS_COLS = [
    "show", "episodes", "total_tokens", "unique_lemmas",
    "content_tokens", "unique_content_lemmas", "tokens_per_ep", "unique_per_ep",
]
_META_COLS = [
    "anilist_id", "title_romaji", "title_english", "genres",
    "score", "episodes_listed", "year", "status", "format",
]


def _cov_cols(top_k: list[int]) -> list[str]:
    return [f"cov_{k}" for k in top_k]


def _read_csv(path: Path) -> tuple[list[dict], list[int]]:
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    top_k = sorted(int(c[4:]) for c in (rows[0] if rows else {}) if c.startswith("cov_"))
    return rows, top_k


def _write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def _build_table(rows: list[dict], sort: str, genre: str | None, top_k: list[int]) -> Table:
    cov_col = f"cov_{1000}" if 1000 in top_k else (f"cov_{top_k[-1]}" if top_k else None)

    def sort_key(r: dict) -> tuple:
        if sort == "score":
            raw = r.get("score")
        elif sort == "unique_vocab":
            raw = r.get("unique_lemmas")
        else:
            raw = r.get("tokens_per_ep")
        try:
            val = float(raw) if raw not in (None, "") else None
        except (ValueError, TypeError):
            val = None
        return (0 if val is not None else 1, -(val or 0))

    if genre:
        rows = [r for r in rows if genre.lower() in (r.get("genres") or "").lower()]
    rows = sorted(rows, key=sort_key)

    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Show", min_width=24)
    table.add_column("Year", justify="right")
    table.add_column("Genres", max_width=28)
    table.add_column("Score", justify="right")
    table.add_column("Eps\n(parsed)", justify="right")
    table.add_column("Unique\nVocab", justify="right")
    table.add_column("Tokens\n/Episode", justify="right")
    if cov_col:
        k_label = cov_col.split("_")[1]
        table.add_column(f"Top-{k_label}\nCoverage", justify="right")

    for r in rows:
        name = r.get("title_romaji") or r.get("title_english") or r["show"]
        try:
            cov_str = f"{float(r[cov_col]) * 100:.1f}%" if cov_col and r.get(cov_col) else "?"
        except (ValueError, TypeError):
            cov_str = "?"
        row_data = [
            name,
            str(r.get("year") or "?"),
            (r.get("genres") or "?").replace(";", ", "),
            str(r.get("score") or "?"),
            str(r.get("episodes") or "?"),
            f"{int(r.get('unique_lemmas') or 0):,}",
            f"{float(r.get('tokens_per_ep') or 0):,.0f}",
        ]
        if cov_col:
            row_data.append(cov_str)
        table.add_row(*row_data)

    return table


_KITSUNEKKO_REPO = "Ajatt-Tools/kitsunekko-archive-2026"
_GITHUB_API = "https://api.github.com"
_SUB_EXTS = {".srt", ".ass", ".ssa"}


def cmd_fetch(args) -> None:
    repo = args.repo
    needle = args.show.lower()
    headers = {"Accept": "application/vnd.github+json"}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"

    # Try the show name as-is first, then search if that fails
    encoded = urllib.parse.quote(args.show, safe="")
    url = f"{_GITHUB_API}/repos/{repo}/contents/subtitles/anime_tv/{encoded}"
    resp = requests.get(url, headers=headers, timeout=15)

    if resp.status_code == 404:
        # Search by listing the parent dir (paginated)
        console.log(f"Exact match not found, searching for '{args.show}'...")
        matches = []
        page = 1
        while True:
            r = requests.get(
                f"{_GITHUB_API}/repos/{repo}/contents/subtitles/anime_tv",
                headers=headers, params={"per_page": 100, "page": page}, timeout=15,
            )
            if r.status_code != 200 or not r.json():
                break
            entries = r.json()
            matches += [e for e in entries if needle in e["name"].lower() and e["type"] == "dir"]
            if len(entries) < 100:
                break
            page += 1

        if not matches:
            console.print(f"[red]No show matching '{args.show}' found.[/red]")
            raise SystemExit(1)
        if len(matches) > 1:
            console.print("Multiple matches — pick one with --show using the exact name:")
            for m in matches:
                console.print(f"  {m['name']}")
            raise SystemExit(1)

        resp = requests.get(matches[0]["url"], headers=headers, timeout=15)

    if resp.status_code != 200:
        console.print(f"[red]GitHub API error {resp.status_code}: {resp.text[:200]}[/red]")
        raise SystemExit(1)

    files = sorted(
        [e for e in resp.json() if e["type"] == "file" and Path(e["name"]).suffix.lower() in _SUB_EXTS],
        key=lambda e: e["name"],
    )
    if not files:
        console.print("[red]No subtitle files found for this show.[/red]")
        raise SystemExit(1)

    idx = args.episode - 1
    if not (0 <= idx < len(files)):
        console.print(f"[red]Episode {args.episode} out of range — {len(files)} file(s) available.[/red]")
        for i, f in enumerate(files, 1):
            console.print(f"  {i}: {f['name']}")
        raise SystemExit(1)

    ep = files[idx]
    console.log(f"Downloading [bold]{ep['name']}[/bold] (episode {args.episode}/{len(files)})...")
    dl = requests.get(ep["download_url"], headers=headers, timeout=30)
    if dl.status_code != 200:
        console.print(f"[red]Download failed: {dl.status_code}[/red]")
        raise SystemExit(1)

    suffix = Path(ep["name"]).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(dl.content)
        tmp_path = Path(tmp.name)

    try:
        lines = subtitles.extract_lines(tmp_path)
    finally:
        tmp_path.unlink()

    output_path = Path(args.output) if args.output else Path(ep["name"]).with_suffix(".txt")
    output_path.write_text("\n".join(lines), encoding="utf-8")
    console.log(f"Wrote [bold]{len(lines)}[/bold] lines → [bold]{output_path}[/bold]")


def cmd_process(args) -> None:
    t_start = time.time()

    subs_dir = Path(args.subtitles_dir)
    if not subs_dir.exists():
        console.print(f"[red]subtitles_dir not found: {subs_dir}[/red]")
        console.print("Run [bold]make setup[/bold] to clone the kitsunekko archive.")
        raise SystemExit(1)

    console.log(f"Discovering shows in [bold]{subs_dir}[/bold]")
    shows = subtitles.discover_shows(subs_dir)
    if args.show:
        needle = args.show.lower()
        shows = {k: v for k, v in shows.items() if needle in k.lower()}
        if not shows:
            console.print(f"[red]No show matching '{args.show}' found in {subs_dir}[/red]")
            raise SystemExit(1)
    elif args.limit:
        shows = dict(islice(shows.items(), args.limit))
    console.log(f"Found [bold]{len(shows)}[/bold] show(s)")

    tagger = tokenizer.build_tagger()
    console.log("MeCab tagger initialized")
    console.log(f"Tokenizing [bold]{len(shows)}[/bold] shows...")

    rows = []
    skipped = 0
    total_tokens = 0
    t_tok = time.time()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Tokenizing...", total=len(shows))

        for i, (show_name, episode_paths) in enumerate(shows.items(), 1):
            progress.update(task, description=f"[cyan]{show_name[:40]}[/cyan]")

            episode_texts = [subtitles.extract_text(p) for p in episode_paths]
            episode_token_lists = [tokenizer.tokenize(text, tagger) for text in episode_texts]
            stats = tokenizer.compute_show_stats(episode_token_lists, top_k=args.top_k)

            if stats["episode_count_parsed"] < args.min_episodes:
                skipped += 1
                progress.advance(task)
                continue

            total_tokens += stats["total_tokens"]
            row = {
                "show": show_name,
                "episodes": stats["episode_count_parsed"],
                "total_tokens": stats["total_tokens"],
                "unique_lemmas": stats["unique_lemmas"],
                "content_tokens": stats["content_tokens"],
                "unique_content_lemmas": stats["unique_content_lemmas"],
                "tokens_per_ep": stats["tokens_per_episode"],
                "unique_per_ep": stats["unique_per_episode"],
            }
            for k in args.top_k:
                row[f"cov_{k}"] = stats["top_k_coverage"].get(str(k), "")
            rows.append(row)
            progress.advance(task)

            if i % 500 == 0 or i == len(shows):
                elapsed = time.time() - t_tok
                console.log(
                    f"Tokenized [cyan]{i}/{len(shows)}[/cyan] "
                    f"| {i/elapsed:.1f} shows/s "
                    f"| {total_tokens:,} tokens"
                    + (f" | {skipped} skipped" if skipped else "")
                )

    elapsed = time.time() - t_tok
    console.log(
        f"Done: [bold]{len(rows)}[/bold] shows, {skipped} skipped, "
        f"{total_tokens:,} tokens in [bold]{elapsed:.1f}s[/bold] ({len(rows)/elapsed:.1f} shows/s)"
    )

    output_path = Path(args.output)
    _write_csv(output_path, rows, _STATS_COLS + _cov_cols(args.top_k))
    console.log(f"Wrote [bold]{output_path}[/bold] ({len(rows)} rows, {output_path.stat().st_size // 1024} KB)")
    console.log(f"Total: [bold]{time.time() - t_start:.1f}s[/bold]")


def cmd_enrich(args) -> None:
    t_start = time.time()

    input_path = Path(args.input)
    if not input_path.exists():
        console.print(f"[red]Not found: {input_path}[/red]")
        raise SystemExit(1)

    rows, top_k = _read_csv(input_path)
    console.log(f"Loaded [bold]{len(rows)}[/bold] shows from [bold]{input_path}[/bold]")

    cache_path = Path(args.cache)
    cache = anilist.load_cache(cache_path)
    show_names = [r["show"] for r in rows]
    n_cached = sum(1 for n in show_names if n.lower().strip() in cache)
    n_uncached = len(show_names) - n_cached
    n_batches = -(-n_uncached // args.batch_size)
    console.log(
        f"AniList cache: [green]{n_cached}[/green] hits, "
        f"[yellow]{n_uncached}[/yellow] to fetch "
        f"→ [bold]{n_batches}[/bold] batch request(s) "
        f"(~{n_batches / args.rate:.0f}s at {args.rate} req/s)"
    )

    stats = {"done": 0, "hits": 0, "fetched": 0, "unmatched": 0}

    def _on_done(name: str, meta: dict | None, hit: bool) -> None:
        stats["done"] += 1
        if hit:
            stats["hits"] += 1
        else:
            stats["fetched"] += 1
        if meta is None:
            stats["unmatched"] += 1
        n = stats["done"]
        if n % 200 == 0 or n == len(rows):
            console.log(
                f"AniList [cyan]{n}/{len(rows)}[/cyan] "
                f"— {stats['hits']} cached, {stats['fetched']} fetched, "
                f"{stats['unmatched']} unmatched"
            )

    console.log(f"Querying AniList (batch_size={args.batch_size}, rate={args.rate} req/s)...")
    anilist_results = anilist.prefetch_all(
        show_names, cache, cache_path,
        batch_size=args.batch_size,
        rate=args.rate,
        on_done=_on_done,
    )
    console.log(
        f"AniList complete — "
        f"[green]{stats['hits']}[/green] cached, "
        f"[yellow]{stats['fetched']}[/yellow] fetched, "
        f"[red]{stats['unmatched']}[/red] unmatched"
    )

    for row in rows:
        meta = anilist_results.get(row["show"]) or {}
        row["anilist_id"] = meta.get("id", "")
        row["title_romaji"] = meta.get("title_romaji", "")
        row["title_english"] = meta.get("title_english", "")
        row["genres"] = ";".join(meta.get("genres") or [])
        row["score"] = meta.get("score", "")
        row["episodes_listed"] = meta.get("episodes", "")
        row["year"] = meta.get("year", "")
        row["status"] = meta.get("status", "")
        row["format"] = meta.get("format", "")

    output_path = Path(args.output)
    _write_csv(output_path, rows, _STATS_COLS + _cov_cols(top_k) + _META_COLS)
    console.log(f"Wrote [bold]{output_path}[/bold]")

    console.print(_build_table(rows, args.sort, args.genre, top_k))
    console.log(f"Total: [bold]{time.time() - t_start:.1f}s[/bold]")


def main():
    parser = argparse.ArgumentParser(
        description="Japanese vocabulary analysis from anime subtitles."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    f = sub.add_parser("fetch", help="Download one episode's subtitles → text file (one line per sentence)")
    f.add_argument("show", help="Show name (substring match against folder names)")
    f.add_argument("episode", nargs="?", type=int, default=1, help="Episode number (default: 1)")
    f.add_argument("--output", metavar="FILE", help="Output path (default: <episode_filename>.txt)")
    f.add_argument("--repo", default=_KITSUNEKKO_REPO, help="GitHub repo (owner/name)")
    f.add_argument("--token", default=None, help="GitHub token for higher rate limits")

    p = sub.add_parser("process", help="Tokenize subtitles → stats.csv")
    p.add_argument("subtitles_dir", nargs="?", default=str(DEFAULT_DATA_DIR))
    p.add_argument("--output", default="stats.csv")
    p.add_argument("--top-k", nargs="+", type=int, default=DEFAULT_TOP_K, metavar="K")
    p.add_argument("--show", metavar="NAME", help="Process only shows whose folder name contains NAME")
    p.add_argument("--limit", type=int)
    p.add_argument("--min-episodes", type=int, default=1, metavar="N")

    e = sub.add_parser("enrich", help="Add AniList metadata to a stats CSV")
    e.add_argument("input", help="CSV produced by the process command")
    e.add_argument("--output", default="enriched.csv")
    e.add_argument("--cache", default=str(Path(__file__).parent / "cache.json"))
    e.add_argument("--batch-size", type=int, default=50, metavar="N")
    e.add_argument("--rate", type=float, default=1.0, metavar="RPS")
    e.add_argument("--sort", choices=["score", "unique_vocab", "words_per_episode"], default="score")
    e.add_argument("--genre")

    args = parser.parse_args()
    {"fetch": cmd_fetch, "process": cmd_process, "enrich": cmd_enrich}[args.command](args)


if __name__ == "__main__":
    main()
