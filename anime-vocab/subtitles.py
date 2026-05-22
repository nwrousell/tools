import io
import re
from pathlib import Path

import ass as ass_lib

_SRT_STRIP = re.compile(
    r"^\d+$"                                    # sequence numbers
    r"|^\d{2}:\d{2}:\d{2},\d{3} --> .*$"       # timestamp lines
    r"|^$",                                     # blank lines
    re.MULTILINE,
)

_ASS_OVERRIDE = re.compile(r"\{[^}]*\}")
_ASS_ESCAPES = re.compile(r"\\[Nnh]")

_ENCODINGS = ["utf-8-sig", "utf-16", "utf-8", "shift-jis", "cp932", "latin-1"]


def _decode(data: bytes) -> str:
    for enc in _ENCODINGS:
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("latin-1", errors="replace")


def extract_text_srt(path: Path) -> str:
    raw = _decode(path.read_bytes())
    return _SRT_STRIP.sub("", raw).strip()


def extract_text_ass(path: Path) -> str:
    raw = path.read_bytes()
    text = _decode(raw)
    try:
        doc = ass_lib.parse(io.StringIO(text))
        lines = []
        for event in doc.events:
            if event.TYPE == "Dialogue":
                cleaned = _ASS_OVERRIDE.sub("", event.text)
                cleaned = _ASS_ESCAPES.sub(" ", cleaned)
                lines.append(cleaned)
        return "\n".join(lines)
    except Exception:
        # fallback: strip override tags from raw text
        return _ASS_OVERRIDE.sub("", _ASS_ESCAPES.sub(" ", text))


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".srt":
        return extract_text_srt(path)
    elif suffix in (".ass", ".ssa"):
        return extract_text_ass(path)
    return ""


def extract_lines(path: Path) -> list[str]:
    """Return one dialogue line per subtitle block, with tags/timestamps stripped."""
    suffix = path.suffix.lower()
    if suffix == ".srt":
        return _extract_lines_srt(path)
    elif suffix in (".ass", ".ssa"):
        return _extract_lines_ass(path)
    return []


def _extract_lines_srt(path: Path) -> list[str]:
    raw = _decode(path.read_bytes())
    lines = []
    for block in re.split(r"\n{2,}", raw.strip()):
        text = "\n".join(
            l for l in block.splitlines()
            if not re.match(r"^\d+$", l.strip())
            and not re.match(r"^\d{2}:\d{2}:\d{2}", l.strip())
        ).strip()
        if text:
            lines.append(text.replace("\n", " "))
    return lines


def _extract_lines_ass(path: Path) -> list[str]:
    raw = path.read_bytes()
    text = _decode(raw)
    try:
        doc = ass_lib.parse(io.StringIO(text))
        lines = []
        for event in doc.events:
            if event.TYPE == "Dialogue":
                cleaned = _ASS_ESCAPES.sub(" ", _ASS_OVERRIDE.sub("", event.text)).strip()
                if cleaned:
                    lines.append(cleaned)
        return lines
    except Exception:
        lines = []
        for line in text.splitlines():
            if line.startswith("Dialogue:"):
                parts = line.split(",", 9)
                if len(parts) >= 10:
                    cleaned = _ASS_ESCAPES.sub(" ", _ASS_OVERRIDE.sub("", parts[9])).strip()
                    if cleaned:
                        lines.append(cleaned)
        return lines


def discover_shows(root: Path) -> dict[str, list[Path]]:
    shows: dict[str, list[Path]] = {}
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        episodes = sorted(
            p for p in entry.rglob("*")
            if p.suffix.lower() in (".srt", ".ass", ".ssa") and not p.name.startswith(".")
        )
        if episodes:
            shows[entry.name] = episodes
    return shows
