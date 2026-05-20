#!/usr/bin/env python3
import argparse
import json
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
    args = parser.parse_args()

    subs_dir = Path(args.subtitles_dir)
    if not subs_dir.exists():
        console.print(f"[red]subtitles_dir not found: {subs_dir}[/red]")
        console.print("Run [bold]make setup[/bold] to clone the kitsunekko archive.")
        raise SystemExit(1)

    console.print(f"[bold]Discovering shows in[/bold] {subs_dir}")
    shows = subtitles.discover_shows(subs_dir)
    if args.limit:
        shows = dict(islice(shows.items(), args.limit))
    console.print(f"Found [bold]{len(shows)}[/bold] shows")

    cache_path = Path(args.cache)
    cache = anilist.load_cache(cache_path)
    last_req: list[float] = [0.0]

    tagger = tokenizer.build_tagger()

    results = []
    unmatched = []

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Processing shows...", total=len(shows))

        for show_name, episode_paths in shows.items():
            progress.update(task, description=f"[cyan]{show_name[:40]}[/cyan]")

            episode_texts = [subtitles.extract_text(p) for p in episode_paths]
            episode_token_lists = [tokenizer.tokenize(text, tagger) for text in episode_texts]
            stats = tokenizer.compute_show_stats(episode_token_lists, top_k=args.top_k)

            if stats["episode_count_parsed"] < args.min_episodes:
                progress.advance(task)
                continue

            metadata = None
            if not args.no_anilist:
                metadata = anilist.fetch_metadata(show_name, cache, cache_path, last_req)
                if metadata is None:
                    unmatched.append(show_name)

            results.append({"show_folder": show_name, "metadata": metadata, "stats": stats})
            progress.advance(task)

    # write JSON (exclude freq_dist from summary, keep it full in the file)
    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    console.print(f"\n[green]Results written to[/green] {output_path}")

    table = build_table(results, args.sort, args.genre)
    console.print(table)

    if unmatched:
        console.print(
            f"\n[yellow][WARN] {len(unmatched)} show(s) had no AniList match:[/yellow]"
        )
        for name in unmatched:
            console.print(f"  • {name}")


if __name__ == "__main__":
    main()
