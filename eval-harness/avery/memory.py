"""Markdown memory + keyword recall (no vector DB — RESOLVED Q2).

Memory is two plain files, `facts.md` and `notes.md`. `recall(query)` is a keyword search over
their lines; it returns line-addressable hits (`facts.md:15`) so every cite() can point at a
real, inspectable line. This keeps the transcript honest about *what Avery actually read*.
Swap in a vector index later behind this same signature with zero loop changes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_WORD = re.compile(r"[a-z0-9]+")
# T8/#57 · 中日韩表意文字的连续段。`_WORD` 只认 `[a-z0-9]+`，一整句中文在它眼里**一个 token 都没有**
# —— 于是关键词 recall 对中文语料恒返回空列表。这不是"召回差"，是"完全够不着"：
# 上传的中文资料、员工填的中文周报，走关键词那条腿时一行都检索不到。
# 🔴 为什么以前没人发现：mock 侧 recall 落空会兜底成一条 `facts.md:1` 的罐头引用
# （service/live_input.py:139），屏幕上照样有一条形状完美的引用——门看着是绿的。
# 🔴 影响面：真 brain 走 `tools.py:157` 的 `embedder=ctx.embedder`，配了 DashScope 就走语义排序，
# 中文没问题；但 `avery/embeddings.py:145` 明写着 key 缺失/轮换即降级到关键词，
# 「降级不会让 advise 挂掉」这句话对中文客户不成立——它降到的是**零证据**。
_CJK = re.compile(r"[一-鿿㐀-䶿぀-ヿ가-힯]+")
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were",
    "her", "his", "their", "she", "he", "they", "it", "that", "this", "with", "has", "have",
    "at", "by", "as", "be", "but", "not", "no", "do", "does", "what", "how", "should", "i",
    "me", "my", "you", "your", "about", "any", "can", "could", "would",
}

MEMORY_FILES = ("facts.md", "notes.md")


@dataclass
class Hit:
    source: str   # e.g. "facts.md:15"
    text: str
    score: float  # keyword: distinct query tokens matched · vector: cosine similarity

    def as_line(self) -> str:
        return f"{self.source}  {self.text}"


def _tokens(s: str) -> set[str]:
    """拉丁词 + 中日韩二元组（bigram）。

    中文没有空格分词，逐字切又太糙（「宴会」「会厅」这种搭配才是信息量所在），所以按相邻两字
    切二元组 —— 检索里最便宜也最稳的中文索引法，无需分词词典、纯离线、确定性。
    单字段（一个字自成一段，如「人」）保底收自己，否则那一段会消失。
    ⚠ 分数口径不变（命中的**不同** token 数），只是中文这边现在真的有 token 可命中了。
    """
    s = s.lower()
    toks = {w for w in _WORD.findall(s) if w not in _STOP and len(w) > 1}
    for run in _CJK.findall(s):
        if len(run) == 1:
            toks.add(run)
        else:
            toks.update(run[i:i + 2] for i in range(len(run) - 1))
    return toks


def load_facts_head(memory_dir: Path, max_lines: int = 12) -> str:
    """The 'first N lines' pattern (Claude Code): a slice of facts.md preloaded into context;
    the rest is pulled on demand via recall(), keeping context lean."""
    path = Path(memory_dir) / "facts.md"
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8").splitlines()
    body = [ln for ln in lines if ln.strip() and not ln.lstrip().startswith(">")]
    return "\n".join(body[:max_lines])


def candidate_text(raw: str) -> str:
    """一行原始文本 → 它在候选面里的**规范形**。

    ONE RULER（doc_key_of 的同一条教训）：这把尺决定「两行算不算同一行」。`_candidates` 自己
    要用它把 facts.md 的行规范化；`ingest/references.py` 反向查找时（材料块原文 → 它落在
    facts.md 的哪一行）必须用**逐字符相同**的尺，否则 join 会在 `- ` 前缀这种小差别上整片落空
    ——#70 的病根就是这个：materialize_memory 把材料块**原样**写进 facts.md（bullet 带着
    `- `），而这里读出来时 `- ` 已经被剥掉，于是「块原文 in 候选文本」对所有 bullet 行恒假，
    一份 19 块的纪要只 join 到 4 行样板话。
    """
    return raw.strip().lstrip("- ").strip()


def _candidates(memory_dir: Path) -> list[tuple[str, str]]:
    """Every citable line of facts.md + notes.md as (source, text). Source is `<file>:<line>` with
    the TRUE 1-based line number so a cite() resolves; headings/quotes/blank lines are skipped —
    the exact same iteration keyword recall and semantic recall both rank over."""
    cands: list[tuple[str, str]] = []
    for fname in MEMORY_FILES:
        path = Path(memory_dir) / fname
        if not path.exists():
            continue
        for i, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith(("#", ">")):
                continue
            cands.append((f"{fname}:{i}", candidate_text(line)))
    return cands


def _corpus_cache_key(memory_dir: Path, embedder_name: str) -> str:
    """Key the per-corpus embedding cache on the dir + file mtimes so a re-materialized context
    (same path, new content) re-embeds instead of serving stale vectors."""
    parts = [str(memory_dir), embedder_name]
    for fname in MEMORY_FILES:
        path = Path(memory_dir) / fname
        parts.append(f"{fname}:{path.stat().st_mtime_ns if path.exists() else 0}")
    return "|".join(parts)


def recall(query: str, memory_dir: Path, limit: int = 8, embedder=None) -> list[Hit]:
    """Search facts.md + notes.md; return line-addressable hits (`facts.md:15`) the model can cite().

    embedder is None (default) -> KEYWORD: rank lines by distinct query tokens matched. Offline,
        deterministic, no service. Every existing caller uses this path unchanged.
    embedder given             -> SEMANTIC: rank the SAME lines by embedding cosine (finds the right
        evidence even when the words differ). Sources stay `<file>:<line>` so the cite gate is
        untouched. Any embedding failure falls back to keyword — a live endpoint can never break an
        advise turn.
    """
    cands = _candidates(memory_dir)
    if not cands:
        return []

    if embedder is not None:
        try:
            from avery import embeddings
            ranked = embeddings.semantic_rank(
                query, cands, embedder, limit=limit,
                cache_key=_corpus_cache_key(memory_dir, getattr(embedder, "name", "embedder")))
            return [Hit(source=s, text=t, score=score) for s, t, score in ranked]
        except Exception:
            pass  # fall back to keyword — never fail the retrieval on an embedding hiccup

    q = _tokens(query)
    hits: list[Hit] = []
    for source, text in cands:
        matched = q & _tokens(text)
        if matched:
            hits.append(Hit(source=source, text=text, score=float(len(matched))))
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]


def resolve_ref(source_ref: str, memory_dir: Path, case_path: Path | None) -> str | None:
    """Return the exact line a `cite()` source_ref points at, or None if it doesn't resolve.
    Accepts 'facts.md:15', 'notes.md:2', or '<case-basename>:12' / 'case:12'."""
    m = re.match(r"\s*([^:]+):(\d+)\s*$", source_ref or "")
    if not m:
        return None
    name, lineno = m.group(1).strip(), int(m.group(2))
    if name in MEMORY_FILES:
        path = Path(memory_dir) / name
    elif case_path is not None and (name in ("case", Path(case_path).name, Path(case_path).stem)):
        path = Path(case_path)
    else:
        return None
    if not path.exists():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1].strip()
    return None
