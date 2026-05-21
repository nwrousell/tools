"""Build a Tofugu-mnemonic hiragana Anki deck.

Scrapes the 46 basic hiragana mnemonic images from tofugu.com/japanese/learn-hiragana/,
splits each image into the plain character (left) and the mnemonic illustration (right),
and packages them into an Anki .apkg deck.

Card layout:
  Front: plain character image
  Back:  mnemonic image + the hiragana character + its romaji
"""

from __future__ import annotations

import shutil
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import genanki
import numpy as np
import requests
from PIL import Image

BASE = "https://files.tofugu.com/articles/japanese/2014-06-30-learn-hiragana/"

# (hiragana, romaji, filename-on-tofugu-CDN). Ordered by gojuon (a-i-u-e-o, ka-ki-ku-ke-ko, ...).
HIRAGANA: list[tuple[str, str, str]] = [
    ("あ", "a",   "あ.png"),
    ("い", "i",   "い.png"),
    ("う", "u",   "う.png"),
    ("え", "e",   "え.png"),
    ("お", "o",   "お.jpg"),
    ("か", "ka",  "か-mosquito.png"),
    ("き", "ki",  "き.png"),
    ("く", "ku",  "く.png"),
    ("け", "ke",  "け-kelp.png"),
    ("こ", "ko",  "こ.png"),
    ("さ", "sa",  "さ-salsa.jpg"),
    ("し", "shi", "し-sheperds-crook.png"),
    ("す", "su",  "す.png"),
    ("せ", "se",  "せ.png"),
    ("そ", "so",  "そ-soda.png"),
    ("た", "ta",  "た-taco.png"),
    ("ち", "chi", "ち-say-cheese.png"),
    ("つ", "tsu", "つ-tsunami.jpg"),
    ("て", "te",  "て-telescope.png"),
    ("と", "to",  "と.png"),
    ("な", "na",  "な.jpg"),
    ("に", "ni",  "に.jpg"),
    ("ぬ", "nu",  "ぬ.jpg"),
    ("ね", "ne",  "ね.png"),
    ("の", "no",  "の.jpg"),
    ("は", "ha",  "は.png"),
    ("ひ", "hi",  "ひ.jpg"),
    ("ふ", "fu",  "ふ-fool-hula-hoop.jpg"),
    ("へ", "he",  "へ.jpg"),
    ("ほ", "ho",  "ほ.png"),
    ("ま", "ma",  "ま.jpg"),
    ("み", "mi",  "み.jpg"),
    ("む", "mu",  "む.jpg"),
    ("め", "me",  "め.jpg"),
    ("も", "mo",  "も.jpg"),
    ("や", "ya",  "や-yacht.png"),
    ("ゆ", "yu",  "ゆ.png"),
    ("よ", "yo",  "よ-yo.jpg"),
    ("ら", "ra",  "ら-rabbit.png"),
    ("り", "ri",  "り.png"),
    ("る", "ru",  "る.png"),
    ("れ", "re",  "れ.png"),
    ("ろ", "ro",  "ろ.png"),
    ("わ", "wa",  "わ-wasp.png"),
    ("を", "wo",  "を.png"),
    ("ん", "n",   "ん.png"),
]

ROOT = Path(__file__).parent
RAW_DIR = ROOT / "images" / "raw"
FRONT_DIR = ROOT / "images" / "front"
BACK_DIR = ROOT / "images" / "back"
MEDIA_DIR = ROOT / "images" / "media"
OUTPUT_APKG = ROOT / "tofugu-hiragana.apkg"

# Stable IDs so re-running the script updates the same deck/model instead of duplicating them.
DECK_ID = 1834729502
MODEL_ID = 1607384231


def download_one(romaji: str, filename: str) -> Path:
    """Download a single source image, skipping if already cached."""
    suffix = Path(filename).suffix
    out = RAW_DIR / f"{romaji}{suffix}"
    if out.exists() and out.stat().st_size > 0:
        return out
    url = BASE + urllib.parse.quote(filename)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    out.write_bytes(resp.content)
    return out


def download_all() -> dict[str, Path]:
    """Download every Tofugu mnemonic image in parallel."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(download_one, romaji, fname): romaji
            for _, romaji, fname in HIRAGANA
        }
        for fut in as_completed(futures):
            romaji = futures[fut]
            paths[romaji] = fut.result()
            print(f"  downloaded {romaji}")
    return paths


def find_split_column(img: Image.Image) -> int:
    """Find the x-coordinate to split a Tofugu mnemonic image at.

    The mnemonic illustrations on the right are sometimes wider than the plain
    character on the left, so a strict 50/50 split clips them. We instead find
    the widest run of fully-empty (transparent or near-white) columns inside the
    central 60% of the image and split at its midpoint. Falls back to w//2 if
    no clear gap is found.
    """
    arr = np.array(img.convert("RGBA"))
    h, w, _ = arr.shape
    alpha = arr[..., 3]
    rgb = arr[..., :3]
    # A pixel counts as background if it is mostly transparent or near-white.
    bg = (alpha < 16) | (rgb >= 245).all(axis=-1)
    # A column is empty iff every pixel in it is background.
    col_empty = bg.all(axis=0)

    lo, hi = int(w * 0.2), int(w * 0.8)
    best_start = best_end = -1
    best_len = 0
    i = lo
    while i < hi:
        if not col_empty[i]:
            i += 1
            continue
        j = i
        while j < hi and col_empty[j]:
            j += 1
        run_len = j - i
        if run_len > best_len:
            best_len = run_len
            best_start, best_end = i, j
        i = j

    # Demand a meaningful gap before trusting it (~2% of width).
    if best_len >= max(8, int(w * 0.02)):
        return (best_start + best_end) // 2
    return w // 2


def split_image(src: Path, front_out: Path, back_out: Path) -> int:
    """Split a Tofugu mnemonic image into plain-character / mnemonic halves.

    Returns the x-coordinate where the split was made (for logging/inspection).
    Both halves are saved as PNG with the original alpha channel preserved.
    """
    with Image.open(src) as img:
        img = img.convert("RGBA")
        w, h = img.size
        mid = find_split_column(img)
        left = img.crop((0, 0, mid, h))
        right = img.crop((mid, 0, w, h))
        left.save(front_out, format="PNG", optimize=True)
        right.save(back_out, format="PNG", optimize=True)
    return mid


def split_all(raw_paths: dict[str, Path]) -> list[tuple[str, str, Path, Path]]:
    """Split every downloaded image. Returns (char, romaji, front_path, back_path) tuples."""
    FRONT_DIR.mkdir(parents=True, exist_ok=True)
    BACK_DIR.mkdir(parents=True, exist_ok=True)
    result: list[tuple[str, str, Path, Path]] = []
    for char, romaji, _ in HIRAGANA:
        src = raw_paths[romaji]
        front = FRONT_DIR / f"{romaji}.png"
        back = BACK_DIR / f"{romaji}.png"
        with Image.open(src) as probe:
            src_w = probe.size[0]
        mid = split_image(src, front, back)
        ratio = mid / src_w
        flag = "" if 0.42 <= ratio <= 0.58 else "  (off-center)"
        print(f"  split {romaji:>3}  at x={mid}/{src_w}  ratio={ratio:.2f}{flag}")
        result.append((char, romaji, front, back))
    return result


def build_deck(entries: list[tuple[str, str, Path, Path]]) -> None:
    """Build the .apkg from split images using genanki."""
    model = genanki.Model(
        MODEL_ID,
        "Tofugu Hiragana Mnemonic",
        fields=[
            {"name": "Character"},
            {"name": "Romaji"},
            {"name": "FrontImage"},
            {"name": "BackImage"},
        ],
        templates=[
            {
                "name": "Recognition",
                "qfmt": '<div class="char-img">{{FrontImage}}</div>',
                "afmt": (
                    '<div class="char-img">{{FrontImage}}</div><hr id="answer">'
                    '<div class="char-img">{{BackImage}}</div>'
                    '<div class="reading"><span class="kana">{{Character}}</span>'
                    ' &mdash; <span class="romaji">{{Romaji}}</span></div>'
                ),
            },
        ],
        css=(
            ".card { font-family: sans-serif; text-align: center; background: #fff; }\n"
            ".char-img img { max-width: 90%; height: auto; }\n"
            ".reading { margin-top: 1em; font-size: 28px; }\n"
            ".kana { font-size: 48px; font-weight: bold; }\n"
            ".romaji { color: #555; }\n"
        ),
    )

    deck = genanki.Deck(DECK_ID, "Tofugu Hiragana (Mnemonics)")

    # Stage media files with the exact names referenced in the note HTML.
    # genanki bundles media by filename only, so the <img src="..."> must match.
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    media_files: list[str] = []

    for char, romaji, front, back in entries:
        front_name = f"tofugu_hira_front_{romaji}.png"
        back_name = f"tofugu_hira_back_{romaji}.png"
        note = genanki.Note(
            model=model,
            fields=[
                char,
                romaji,
                f'<img src="{front_name}">',
                f'<img src="{back_name}">',
            ],
            guid=genanki.guid_for("tofugu-hiragana", romaji),
        )
        deck.add_note(note)
        staging_front = MEDIA_DIR / front_name
        staging_back = MEDIA_DIR / back_name
        shutil.copyfile(front, staging_front)
        shutil.copyfile(back, staging_back)
        media_files.append(str(staging_front))
        media_files.append(str(staging_back))

    package = genanki.Package(deck)
    package.media_files = media_files
    package.write_to_file(str(OUTPUT_APKG))
    print(f"  wrote {OUTPUT_APKG} ({OUTPUT_APKG.stat().st_size / 1024:.1f} KB)")


def main() -> int:
    print(f"Downloading {len(HIRAGANA)} mnemonic images...")
    t0 = time.time()
    raw_paths = download_all()
    print(f"  ({time.time() - t0:.1f}s)")

    print("Splitting images into front/back halves...")
    entries = split_all(raw_paths)
    print(f"  wrote {len(entries) * 2} halves into {FRONT_DIR.parent}/")

    print("Building Anki deck...")
    build_deck(entries)

    print("Done. Import the .apkg into Anki via File > Import.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
