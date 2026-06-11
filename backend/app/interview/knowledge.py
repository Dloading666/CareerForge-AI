from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from app.core.config import get_settings


TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+#.-]*|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}")
QUESTION_HEADING_RE = re.compile(r"^(#{2,4})\s*(Q\d+[:：]?.*|.+(?:面试题|场景题|追问|问题).*)$", re.I)
HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)$")


@dataclass
class KnowledgeChunk:
    chunk_id: str
    title: str
    text: str
    domain: str
    category: str
    topic: str
    source_file: str
    vector: Counter[str]


def _read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _tokens(text: str) -> list[str]:
    normalized = text.lower()
    tokens = TOKEN_RE.findall(normalized)
    extra: list[str] = []
    for token in tokens:
        if re.fullmatch(r"[\u4e00-\u9fff]{4,}", token):
            extra.extend(token[i : i + 2] for i in range(max(0, len(token) - 1)))
    return tokens + extra


def _vectorize(text: str) -> Counter[str]:
    return Counter(_tokens(text))


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    dot = sum(a[t] * b[t] for t in common)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


def _split_markdown(text: str) -> list[tuple[str, str]]:
    lines = text.splitlines()
    chunks: list[tuple[str, list[str]]] = []
    current_title = "文档概览"
    current: list[str] = []
    for line in lines:
        question_heading = QUESTION_HEADING_RE.match(line.strip())
        heading = HEADING_RE.match(line.strip())
        should_split = bool(question_heading) or (bool(heading) and len(current) > 80)
        if should_split and current:
            chunks.append((current_title, current))
            current = []
        if question_heading or heading:
            current_title = (question_heading or heading).group(2).strip()
        current.append(line)
    if current:
        chunks.append((current_title, current))

    result: list[tuple[str, str]] = []
    for title, block_lines in chunks:
        block = "\n".join(block_lines).strip()
        if len(block) >= 80:
            result.append((title, block[:5000]))
    return result


def _iter_markdown_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return sorted(root.rglob("*.md"))


class KnowledgeIndex:
    def __init__(self, root: Path):
        self.root = root
        self.chunks: list[KnowledgeChunk] = []
        self.errors: list[str] = []
        self.reload()

    def reload(self) -> None:
        self.chunks = []
        self.errors = []
        for path in _iter_markdown_files(self.root):
            try:
                self._load_file(path)
            except Exception as exc:  # pragma: no cover - defensive index loading
                self.errors.append(f"{path}: {exc}")

    def _load_file(self, path: Path) -> None:
        rel = path.relative_to(self.root)
        parts = rel.parts
        domain = parts[0] if len(parts) >= 1 else "general"
        category = parts[1] if len(parts) >= 2 else "general"
        topic = path.stem
        text = _read_text(path)
        for idx, (title, block) in enumerate(_split_markdown(text), start=1):
            chunk_text = f"{topic}\n{title}\n{block}"
            self.chunks.append(
                KnowledgeChunk(
                    chunk_id=f"{rel.as_posix()}#{idx}",
                    title=title,
                    text=block,
                    domain=domain,
                    category=category,
                    topic=topic,
                    source_file=rel.as_posix(),
                    vector=_vectorize(chunk_text),
                )
            )

    def search(self, query: str, *, target_role: str = "", limit: int = 6) -> list[dict]:
        query_vector = _vectorize(f"{target_role}\n{query}")
        scored: list[tuple[float, KnowledgeChunk]] = []
        query_lower = f"{target_role} {query}".lower()
        query_terms = set(_tokens(query))
        for chunk in self.chunks:
            score = _cosine(query_vector, chunk.vector)
            haystack = f"{chunk.domain} {chunk.category} {chunk.topic} {chunk.title} {chunk.source_file}".lower()
            for token in ("redis", "mysql", "spring", "kafka", "agent", "rag", "mcp", "jvm", "aof", "mvcc", "elasticsearch"):
                if token in query_lower and token in haystack:
                    score += 0.85
            for term in query_terms:
                if len(term) >= 3 and term in haystack:
                    score += 0.18
            if chunk.domain.lower() in query_lower and chunk.domain.lower() != "java":
                score += 0.08
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda item: item[0], reverse=True)
        results = []
        seen_sources: Counter[str] = Counter()
        for score, chunk in scored:
            if seen_sources[chunk.source_file] >= 2:
                continue
            seen_sources[chunk.source_file] += 1
            results.append(
                {
                    "chunk_id": chunk.chunk_id,
                    "title": chunk.title,
                    "snippet": chunk.text[:900],
                    "domain": chunk.domain,
                    "category": chunk.category,
                    "topic": chunk.topic,
                    "source_file": chunk.source_file,
                    "score": round(score, 4),
                }
            )
            if len(results) >= limit:
                break
        return results

    def status(self) -> dict:
        return {
            "root": str(self.root),
            "document_count": len({chunk.source_file for chunk in self.chunks}),
            "chunk_count": len(self.chunks),
            "errors": self.errors[:5],
            "retriever": "local_sparse_vector",
            "vector_ready": True,
        }


@lru_cache(maxsize=1)
def get_knowledge_index() -> KnowledgeIndex:
    return KnowledgeIndex(Path(get_settings().interview_knowledge_base_dir))


def reload_knowledge_index() -> dict:
    index = get_knowledge_index()
    index.reload()
    return index.status()
