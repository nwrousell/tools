#!/usr/bin/env python3
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, Future
from itertools import islice
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.table import Table

import anilist
import subtitles
import tokenizer

console = Console()

DEFAULT_TOP_K = [100, 500, 1000, 2000, 3000, 5000]
DEFAULT_DATA_DIR = Path(__file__).parent / "data" / "subtitles" / "anime_tv"


def _sort_key(result: dict, field: str) -> tuple:
    meta = result.get("metadata") or {}
    stats = result.get("stats") or {}
    has_meta = meta is not None

    if field == "score":
        val = meta.get("score") if has_meta else None
    elif field == "unique_vocab":
        val = stats.get("unique_lemmas")
    elif field == "words_per_episode":
        val = stats.get("tokens_per_episode")
    else:
        val = None

    return (0 if val is not None else 1, -(val or 0))


def _matches_genre(result: dict, genre: str) -> bool:
    meta = result.get("metadata") or {}
    genres = meta.get("genres") or []
    return any(genre.lower() in g.lower() for g in genres)


def _display_name(result: dict) -> str:
    meta = result.get("metadata") or {}
    return meta.get("title_romaji") or meta.get("title_english") or result["show_folder"]


def build_table(results: list[dict], sort: str, genre: str | None) -> Table:
    filtered = results if not genre else [r for r in results if _matches_genre(r, genre)]
    sorted_results = sorted(filtered, key=lambda r: _sort_key(r, sort))

    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Show", min_width=24)
    table.add_column("Year", justify="right")
    table.add_column("Genres", max_width=28)
    table.add_column("Score", justify="right")
    table.add_column("Eps\n(parsed)", justify="right")
    table.add_column("Unique\nVocab", justify="right")
    table.add_column("Tokens\n/Episode", justify="right")
    table.add_column("Top-1000\nCoverage", justify="right")

    for r in sorted_results:
        meta = r.get("metadata") or {}
        stats = r["stats"]
        cov = stats.get("top_k_coverage", {}).get("1000")
        table.add_row(
            _display_name(r),
            str(meta.get("year") or "?"),
            ", ".join((meta.get("genres") or [])[:3]) or "?",
            str(meta.get("score") or "?"),
            f"{stats.get('episode_count_parsed', 0)}",
            f"{stats.get('unique_lemmas', 0):,}",
            f"{stats.get('tokens_per_episode', 0):,.0f}",
            f"{cov*100:.1f}%" if cov is not None else "?",
        )

    return table


def main():
    parser = argparse.ArgumentParser(
        description="Compute Japanese vocabulary statistics for anime from subtitle files."
    )
    parser.add_argument(
        "subtitles_dir",
        nargs="?",
        default=str(DEFAULT_DATA_DIR),
        help="Path to kitsunekko-organized subtitle root (default: ./data)",
    )
    parser.add_argument("--output", default="results.json", help="JSON output path")
    parser.add_argument(
        "--cache", default=str(Path(__file__).parent / "cache.json"), help="AniList cache file"
    )
    parser.add_argument(
        "--sort",
        choices=["score", "unique_vocab", "words_per_episode"],
        default="score",
    )
    parser.add_argument("--genre", help="Filter table by genre (case-insensitive substring)")
    parser.add_argument(
        "--top-k",
        nargs="+",
        type=int,
        default=DEFAULT_TOP_K,
        metavar="K",
        help="Coverage thresholds",
    )
    parser.add_argument("--no-anilist", action="store_true", help="Skip AniList lookups")
    parser.add_argument("--limit", type=int, help="Process only first N shows")
    parser.add_argument(
        "--min-episodes", type=int, default=1, metavar="N",
        help="Skip shows with fewer than N parsed episodes"
    )
    parser.add_argument(
        "--anilist-workers", type=int, default=4, metavar="N",
        help="Parallel workers for AniList fetches (default: 4)",
    )
    parser.add_argument(
        "--anilist-rate", type=float, default=1.0, metavar="RPS",
        help="AniList requests per second (default: 1.0)",
    )
    args = parser.parse_args()

    t_start = time.time()

    subs_dir = Path(args.subtitles_dir)
    if not subs_dir.exists():
        console.print(f"[red]subtitles_dir not found: {subs_dir}[/red]")
        console.print("Run [bold]make setup[/bold] to clone the kitsunekko archive.")
        raise SystemExit(1)

    console.log(f"Discovering shows in [bold]{subs_dir}[/bold]")
    shows = subtitles.discover_shows(subs_dir)
    if args.limit:
        shows = dict(islice(shows.items(), args.limit))
    console.log(f"Found [bold]{len(shows)}[/bold] shows")

    cache_path = Path(args.cache)
    cache = anilist.load_cache(cache_path)
    cache_hits_initial = sum(1 for name in shows if name.lower().strip() in cache)
    console.log(
        f"AniList cache: [green]{cache_hits_initial}[/green] hits, "
        f"[yellow]{len(shows) - cache_hits_initial}[/yellow] need fetching "
        f"([dim]{cache_path.name}[/dim])"
    )

    tagger = tokenizer.build_tagger()
    console.log("MeCab tagger initialized")

    # --- AniList prefetch (runs concurrently with tokenization) ---
    anilist_future: Future | None = None
    anilist_results: dict[str, dict | None] = {}
    anilist_stats = {"done": 0, "hits": 0, "misses": 0, "unmatched": 0}
    anilist_executor: ThreadPoolExecutor | None = None

    if not args.no_anilist:
        limiter = anilist.RateLimiter(rate=args.anilist_rate)

        def _on_anilist_done(name: str, meta: dict | None, hit: bool) -> None:
            anilist_stats["done"] += 1
            if hit:
                anilist_stats["hits"] += 1
            else:
                anilist_stats["misses"] += 1
            if meta is None:
                anilist_stats["unmatched"] += 1
            n = anilist_stats["done"]
            total = len(shows)
            if n % 100 == 0 or n == total:
                console.log(
                    f"AniList: [cyan]{n}/{total}[/cyan] "
                    f"({anilist_stats['hits']} cached, "
                    f"{anilist_stats['misses']} fetched, "
                    f"{anilist_stats['unmatched']} unmatched)"
                )

        anilist_executor = ThreadPoolExecutor(max_workers=1)
        console.log(
            f"Starting AniList prefetch in background "
            f"([bold]{args.anilist_workers}[/bold] workers, "
            f"[bold]{args.anilist_rate}[/bold] req/s)"
        )
        anilist_future = anilist_executor.submit(
            anilist.prefetch_all,
            list(shows.keys()),
            cache,
            cache_path,
            limiter,
            workers=args.anilist_workers,
            on_done=_on_anilist_done,
        )

    # --- Tokenization ---
    results = []
    skipped = 0
    total_tokens = 0
    t_tok_start = time.time()

    console.log(f"Tokenizing [bold]{len(shows)}[/bold] shows...")

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
            results.append({"show_folder": show_name, "stats": stats})
            progress.advance(task)

            if i % 500 == 0 or i == len(shows):
                elapsed = time.time() - t_tok_start
                rate = i / elapsed if elapsed > 0 else 0
                console.log(
                    f"Tokenized [cyan]{i}/{len(shows)}[/cyan] shows "
                    f"| {rate:.1f} shows/s "
                    f"| {total_tokens:,} tokens so far"
                    + (f" | skipped {skipped}" if skipped else "")
                )

    t_tok_end = time.time()
    tok_elapsed = t_tok_end - t_tok_start
    console.log(
        f"Tokenization complete: [bold]{len(results)}[/bold] shows kept, "
        f"{skipped} skipped, "
        f"{total_tokens:,} total tokens "
        f"in [bold]{tok_elapsed:.1f}s[/bold] "
        f"({len(results)/tok_elapsed:.1f} shows/s)"
    )

    # --- Wait for AniList ---
    if anilist_future is not None:
        if not anilist_future.done():
            console.log("Waiting for AniList prefetch to finish...")
        anilist_results = anilist_future.result()
        anilist_executor.shutdown(wait=False)
        console.log(
            f"AniList complete: "
            f"[green]{anilist_stats['hits']}[/green] cached, "
            f"[yellow]{anilist_stats['misses']}[/yellow] fetched, "
            f"[red]{anilist_stats['unmatched']}[/red] unmatched"
        )

    # Merge metadata into results
    unmatched_names = []
    for r in results:
        meta = anilist_results.get(r["show_folder"]) if not args.no_anilist else None
        r["metadata"] = meta
        if not args.no_anilist and meta is None:
            unmatched_names.append(r["show_folder"])

    # --- Write output ---
    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    console.log(f"Results written to [bold]{output_path}[/bold] ({len(results)} shows)")

    table = build_table(results, args.sort, args.genre)
    console.print(table)

    if unmatched_names:
        console.log(f"[yellow]{len(unmatched_names)} show(s) had no AniList match[/yellow]")
        for name in unmatched_names:
            console.print(f"  • {name}")

    total_elapsed = time.time() - t_start
    console.log(f"Done in [bold]{total_elapsed:.1f}s[/bold] total")


if __name__ == "__main__":
    main()
