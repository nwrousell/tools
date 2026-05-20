from collections import Counter

import fugashi

FUNCTION_WORD_POS = frozenset(["助詞", "助動詞", "記号", "補助記号", "空白"])

_TOP_K_DEFAULTS = [100, 500, 1000, 2000, 3000, 5000]


def build_tagger() -> fugashi.Tagger:
    return fugashi.Tagger()


_CHUNK = 50_000  # MeCab can segfault on very long inputs


def tokenize(text: str, tagger: fugashi.Tagger) -> list[dict]:
    # strip null bytes that slip through from UTF-16 misdetection
    text = text.replace("\x00", "")
    if not text.strip():
        return []
    tokens = []
    # process in chunks to avoid MeCab buffer overflow
    for start in range(0, len(text), _CHUNK):
        chunk = text[start:start + _CHUNK]
        _tokenize_chunk(chunk, tagger, tokens)
    return tokens


def _tokenize_chunk(text: str, tagger: fugashi.Tagger, out: list) -> None:
    for word in tagger(text):
        surface = word.surface
        if not surface or not surface.strip():
            continue
        feature = word.feature
        try:
            pos = feature.pos1
        except AttributeError:
            pos = "*"
        try:
            lemma = feature.lemma
        except AttributeError:
            lemma = "*"
        if not lemma or lemma == "*":
            lemma = surface
        out.append({
            "surface": surface,
            "lemma": lemma,
            "pos": pos,
            "is_content": pos not in FUNCTION_WORD_POS,
        })


def compute_show_stats(episode_tokens: list[list[dict]], top_k: list[int] | None = None) -> dict:
    if top_k is None:
        top_k = _TOP_K_DEFAULTS

    all_tokens = [t for ep in episode_tokens for t in ep]
    total = len(all_tokens)
    content = [t for t in all_tokens if t["is_content"]]

    freq: Counter = Counter(t["lemma"] for t in all_tokens)
    most_common = freq.most_common()

    coverage = {}
    cumulative = 0
    sorted_counts = [c for _, c in most_common]
    thresholds = sorted(top_k)
    ti = 0
    for i, count in enumerate(sorted_counts):
        cumulative += count
        while ti < len(thresholds) and i + 1 >= thresholds[ti]:
            coverage[str(thresholds[ti])] = round(cumulative / total, 6) if total else 0.0
            ti += 1
        if ti >= len(thresholds):
            break
    # fill any thresholds beyond the vocab size
    for k in thresholds[ti:]:
        coverage[str(k)] = 1.0 if total else 0.0

    n_eps = len(episode_tokens)
    return {
        "episode_count_parsed": n_eps,
        "total_tokens": total,
        "unique_lemmas": len(freq),
        "content_tokens": len(content),
        "unique_content_lemmas": len(set(t["lemma"] for t in content)),
        "tokens_per_episode": round(total / n_eps, 1) if n_eps else 0.0,
        "unique_per_episode": round(len(freq) / n_eps, 1) if n_eps else 0.0,
        "top_k_coverage": coverage,
        # top 5000 most frequent lemmas stored to keep JSON manageable
        "freq_dist": [[lemma, count] for lemma, count in most_common[:5000]],
    }
