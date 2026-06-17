"""Knowledge base with semantic retrieval powered by ChromaDB + sentence-transformers.

Two backends, same interface:
- ChromaKnowledgeIndex — dense embeddings (BGE-small-zh) + HNSW ANN search
- LegacyKnowledgeIndex — sparse Counter vectors (TF‑IDF like) + brute‑force search

The factory get_knowledge_index() picks the best available backend at startup.
All callers use KnowledgeIndex.search() and need no changes.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# ── Shared constants ───────────────────────────────────────────────────────────

_CHUNK_MAX_CHARS = 800
_CHUNK_OVERLAP_CHARS = 150
_CHROMA_COLLECTION = "interview_knowledge"
_BATCH_SIZE = 64

# Auto‑detect technology keywords from document text
_TECH_KEYWORDS = {
    "Redis", "MySQL", "PostgreSQL", "MongoDB", "Elasticsearch", "Kafka",
    "RabbitMQ", "Docker", "Kubernetes", "Spring", "Spring Boot", "Spring Cloud",
    "MyBatis", "Hibernate", "Vue", "React", "Angular", "TypeScript", "JavaScript",
    "Python", "Go", "Rust", "Java", "C++", "Linux", "JVM", "GC",
    "LLM", "RAG", "Agent", "MCP", "Function Calling", "LangChain",
    "分布式", "微服务", "高并发", "缓存", "消息队列", "数据库事务",
    "Netty", "Nginx", "gRPC", "Protobuf", "Zookeeper", "Sentinel",
}

# ── Markdown‑aware semantic splitter (shared by both backends) ────────────────

def _semantic_split(text: str, max_chars: int = _CHUNK_MAX_CHARS, overlap: int = _CHUNK_OVERLAP_CHARS) -> list[str]:
    """Split on headings → paragraphs → sentence boundaries, with overlap."""
    if len(text) <= max_chars:
        return [text.strip()] if text.strip() else []

    sections = re.split(r"\n(?=#{1,4}\s)", text)
    chunks: list[str] = []

    for section in sections:
        section = section.strip()
        if not section:
            continue
        if len(section) <= max_chars:
            chunks.append(section)
            continue

        paragraphs = section.split("\n\n")
        current = ""
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            if len(current) + len(para) + 2 <= max_chars:
                current = f"{current}\n\n{para}" if current else para
            else:
                if current:
                    chunks.append(current)
                if len(para) > max_chars:
                    chunks.extend(_split_long_text(para, max_chars, overlap))
                else:
                    current = para
        if current:
            chunks.append(current)

    if overlap <= 0 or len(chunks) <= 1:
        return [c for c in chunks if c]

    overlapped = [chunks[0]]
    for i in range(1, len(chunks)):
        prev_tail = chunks[i - 1][-overlap:] if len(chunks[i - 1]) > overlap else chunks[i - 1]
        overlapped.append(prev_tail + "\n" + chunks[i])
    return overlapped


def _split_long_text(text: str, max_chars: int, overlap: int) -> list[str]:
    """Split a long text on Chinese / English sentence boundaries."""
    sentences = re.split(r"(?<=[。！？!?])\s*", text)
    sentences = [s for s in sentences if s.strip()]
    if not sentences:
        return [text[i : i + max_chars] for i in range(0, len(text), max_chars - overlap)]

    chunks: list[str] = []
    current = ""
    for sent in sentences:
        if len(current) + len(sent) <= max_chars:
            current += sent
        else:
            if current:
                chunks.append(current.strip())
            if len(sent) > max_chars:
                for start in range(0, len(sent), max_chars - overlap):
                    chunks.append(sent[start : start + max_chars].strip())
            else:
                current = sent
    if current:
        chunks.append(current.strip())
    return chunks


# ── Shared helpers ────────────────────────────────────────────────────────────

def _detect_tech_tags(text: str) -> list[str]:
    text_lower = text.lower()
    return sorted({tag for tag in _TECH_KEYWORDS if tag.lower() in text_lower})


def _read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _extract_meta(path: Path, rel_root: Path, text: str, file_hash: str) -> dict[str, Any]:
    rel = path.relative_to(rel_root)
    parts = list(rel.parts)
    tech_tags = _detect_tech_tags(text)
    return {
        "source_file": str(rel),
        "domain": parts[0] if len(parts) >= 1 else "general",
        "category": parts[1] if len(parts) >= 2 else "general",
        "topic": path.stem,
        "tech_tags": ",".join(tech_tags) if tech_tags else "",
        "file_hash": file_hash,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }


def _hash_file(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _iter_md_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return
    for ext in ("*.md", "*.MD", "*.txt"):
        yield from sorted(root.rglob(ext))


# ═══════════════════════════════════════════════════════════════════════════════
# Backend A: ChromaDB + sentence-transformers (semantic search)
# ═══════════════════════════════════════════════════════════════════════════════

class ChromaKnowledgeIndex:
    """Dense-embedding knowledge index backed by ChromaDB + BGE‑small‑zh."""

    def __init__(self, root: Path, chroma_dir: Path):
        self.root = root
        self.errors: list[str] = []

        import chromadb
        from sentence_transformers import SentenceTransformer

        self._chroma_dir = chroma_dir
        self._chroma_dir.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=str(self._chroma_dir),
            settings=chromadb.Settings(anonymized_telemetry=False),
        )
        self._model_name = "BAAI/bge-small-zh-v1.5"
        self._embedder = SentenceTransformer(self._model_name)
        expected_dim = self._embedder.get_sentence_embedding_dimension()
        logger.info(
            "ChromaKnowledgeIndex ready — model=%s dims=%d",
            self._model_name, expected_dim,
        )

        # 自动修复维度不匹配：旧数据用其他模型建的，删掉重建
        try:
            existing = self._client.get_collection(name=_CHROMA_COLLECTION)
            if existing and existing.metadata:
                stored_dim = existing.metadata.get("dimension")
                if stored_dim is not None and int(stored_dim) != expected_dim:
                    logger.warning(
                        "ChromaDB 维度不匹配（期望 %d，现有 %d），自动删除旧集合重建",
                        expected_dim, int(stored_dim),
                    )
                    self._client.delete_collection(name=_CHROMA_COLLECTION)
            self._collection = self._client.get_or_create_collection(
                name=_CHROMA_COLLECTION,
                metadata={"hnsw:space": "cosine", "dimension": expected_dim},
            )
        except Exception:
            self._collection = self._client.get_or_create_collection(
                name=_CHROMA_COLLECTION,
                metadata={"hnsw:space": "cosine", "dimension": expected_dim},
            )

        if self._collection.count() == 0:
            logger.info("ChromaDB collection empty, building initial index from %s", self.root)
            self.reload()

    def reload(self) -> None:
        self.errors = []
        if not self.root.exists():
            self.errors.append(f"Knowledge base directory not found: {self.root}")
            return

        current_files = {str(fp.relative_to(self.root)): fp for fp in _iter_md_files(self.root)}
        stored_hashes = self._get_stored_hashes()

        # Remove stale files
        for rel_path in set(stored_hashes) - set(current_files):
            self._remove_by_source(rel_path)

        # Collect changed files
        pending: list[tuple[Path, str]] = []
        for rel_path, fp in current_files.items():
            try:
                new_hash = _hash_file(fp)
            except OSError as exc:
                self.errors.append(f"{rel_path}: {exc}")
                continue
            if stored_hashes.get(rel_path) == new_hash:
                continue
            self._remove_by_source(rel_path)
            pending.append((fp, new_hash))

        for i in range(0, len(pending), _BATCH_SIZE):
            self._ingest_batch(pending[i : i + _BATCH_SIZE])

        logger.info("ChromaKnowledgeIndex reloaded — %d files changed", len(pending))

    def search(self, query: str, *, target_role: str = "", limit: int = 6) -> list[dict[str, Any]]:
        if self._collection.count() == 0:
            return []

        query_text = f"{target_role} {query}".strip()
        query_embedding = self._embedder.encode([query_text], normalize_embeddings=True, show_progress_bar=False)[0]
        results = self._collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=min(limit * 3, self._collection.count()),
        )

        if not results["ids"] or not results["ids"][0]:
            return []

        seen: Counter[str] = Counter()
        merged: list[dict[str, Any]] = []
        for i in range(len(results["ids"][0])):
            meta = (results["metadatas"][0] or [])[i] if results["metadatas"][0] else {}
            src = meta.get("source_file", "") if meta else ""
            if seen[src] >= 2:
                continue
            seen[src] += 1
            doc = (results["documents"][0] or [])[i] if results["documents"] and results["documents"][0] else ""
            merged.append({
                "chunk_id": results["ids"][0][i],
                "title": (meta or {}).get("topic", ""),
                "snippet": (doc or "")[:900],
                "domain": (meta or {}).get("domain", ""),
                "category": (meta or {}).get("category", ""),
                "topic": (meta or {}).get("topic", ""),
                "source_file": src,
                "score": round(1.0 - float((results["distances"][0] or [0])[i]), 4),
            })
            if len(merged) >= limit:
                break
        return merged

    def status(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "document_count": len(self._get_stored_hashes()),
            "chunk_count": self._collection.count(),
            "errors": self.errors[-5:],
            "retriever": "chromadb_hnsw",
            "embedding_model": self._model_name,
            "vector_ready": self._collection.count() > 0,
        }

    def _ingest_batch(self, batch: list[tuple[Path, str]]) -> None:
        all_ids, all_embeddings, all_docs, all_metas = [], [], [], []
        for fp, file_hash in batch:
            try:
                text = _read_text(fp)
            except Exception as exc:
                self.errors.append(f"{fp}: read error — {exc}")
                continue
            chunks = _semantic_split(text)
            if not chunks:
                continue
            try:
                embeddings = self._embedder.encode(chunks, normalize_embeddings=True, show_progress_bar=False)
            except Exception as exc:
                self.errors.append(f"{fp}: embedding error — {exc}")
                continue
            meta = _extract_meta(fp, self.root, text, file_hash)
            for j, chunk in enumerate(chunks):
                all_ids.append(f"{meta['source_file']}#{j}")
                all_embeddings.append(embeddings[j])
                all_docs.append(chunk)
                all_metas.append({**meta, "chunk_index": j})
        if all_ids:
            self._collection.upsert(
                ids=all_ids,
                embeddings=[e.tolist() for e in all_embeddings],
                documents=all_docs,
                metadatas=all_metas,
            )

    def _get_stored_hashes(self) -> dict[str, str]:
        result: dict[str, str] = {}
        if self._collection.count() == 0:
            return result
        data = self._collection.get(limit=self._collection.count(), include=["metadatas"])
        for meta in (data.get("metadatas") or []):
            if meta and "source_file" in meta and "file_hash" in meta:
                result.setdefault(meta["source_file"], meta["file_hash"])
        return result

    def _remove_by_source(self, source_file: str) -> None:
        try:
            existing = self._collection.get(where={"source_file": source_file}, limit=10000)
            if existing["ids"]:
                self._collection.delete(ids=existing["ids"])
        except Exception as exc:
            logger.warning("Failed to remove chunks for %s: %s", source_file, exc)


# ═══════════════════════════════════════════════════════════════════════════════
# Backend B: Counter-based sparse vectors (zero‑dependency fallback)
# ═══════════════════════════════════════════════════════════════════════════════

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+#.-]*|\d+(?:\.\d+)?|[一-鿿]{2,}")


def _tokens(text: str) -> list[str]:
    normalized = text.lower()
    tokens = _TOKEN_RE.findall(normalized)
    extra: list[str] = []
    for token in tokens:
        if re.fullmatch(r"[一-鿿]{4,}", token):
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


@dataclass
class _LegacyChunk:
    chunk_id: str
    title: str
    text: str
    domain: str
    category: str
    topic: str
    source_file: str
    vector: Counter[str]


class LegacyKnowledgeIndex:
    """Counter‑based sparse vector index — zero dependencies, instant startup.

    Preserved as the fallback when ChromaDB / sentence‑transformers is unavailable.
    """

    def __init__(self, root: Path):
        self.root = root
        self.chunks: list[_LegacyChunk] = []
        self.errors: list[str] = []
        self.reload()

    def reload(self) -> None:
        self.chunks = []
        self.errors = []
        for path in _iter_md_files(self.root):
            try:
                self._load_file(path)
            except Exception as exc:
                self.errors.append(f"{path}: {exc}")

    def _load_file(self, path: Path) -> None:
        rel = path.relative_to(self.root)
        parts = rel.parts
        domain = parts[0] if len(parts) >= 1 else "general"
        category = parts[1] if len(parts) >= 2 else "general"
        topic = path.stem
        text = _read_text(path)
        for idx, chunk in enumerate(_semantic_split(text), start=1):
            vector = _vectorize(f"{topic}\n{chunk}")
            self.chunks.append(_LegacyChunk(
                chunk_id=f"{rel.as_posix()}#{idx}",
                title=topic,
                text=chunk,
                domain=domain,
                category=category,
                topic=topic,
                source_file=rel.as_posix(),
                vector=vector,
            ))

    def search(self, query: str, *, target_role: str = "", limit: int = 6) -> list[dict[str, Any]]:
        query_vector = _vectorize(f"{target_role}\n{query}")
        scored: list[tuple[float, _LegacyChunk]] = []
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
            results.append({
                "chunk_id": chunk.chunk_id,
                "title": chunk.title,
                "snippet": chunk.text[:900],
                "domain": chunk.domain,
                "category": chunk.category,
                "topic": chunk.topic,
                "source_file": chunk.source_file,
                "score": round(score, 4),
            })
            if len(results) >= limit:
                break
        return results

    def status(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "document_count": len({chunk.source_file for chunk in self.chunks}),
            "chunk_count": len(self.chunks),
            "errors": self.errors[-5:],
            "retriever": "local_sparse_vector",
            "embedding_model": None,
            "vector_ready": True,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Factory — auto‑selects the best available backend
# ═══════════════════════════════════════════════════════════════════════════════

KnowledgeIndex = LegacyKnowledgeIndex  # default fallback


def _is_embedding_model_cached() -> bool:
    """Check whether the BGE model weights are fully downloaded to the HF cache."""
    import os
    cache_base = os.path.expanduser("~/.cache/huggingface/hub")
    snapshots_dir = Path(cache_base) / "models--BAAI--bge-small-zh-v1.5" / "snapshots"
    if not snapshots_dir.exists():
        return False
    for snap in snapshots_dir.iterdir():
        if not snap.is_dir():
            continue
        # Verify the actual model weight file exists (not just config stubs)
        weights = snap / "model.safetensors"
        if weights.exists() and weights.stat().st_size > 10_000_000:
            return True
        pt_weights = snap / "pytorch_model.bin"
        if pt_weights.exists() and pt_weights.stat().st_size > 10_000_000:
            return True
    return False


def _create_chroma_index(root: Path) -> ChromaKnowledgeIndex | None:
    """Try to create a ChromaKnowledgeIndex.  Returns None on any failure."""
    try:
        import chromadb  # noqa: F401
        from sentence_transformers import SentenceTransformer  # noqa: F401
    except ImportError as exc:
        logger.info("ChromaDB or sentence-transformers not installed, using legacy index. (%s)", exc)
        return None

    if not _is_embedding_model_cached():
        logger.info(
            "Embedding model not cached.  Run once to download:\n"
            "  python -c \"from sentence_transformers import SentenceTransformer; SentenceTransformer('%s')\"\n"
            "Falling back to legacy sparse-vector index.",
            "BAAI/bge-small-zh-v1.5",
        )
        return None

    chroma_dir = Path(get_settings().chroma_persist_dir)
    try:
        return ChromaKnowledgeIndex(root, chroma_dir)
    except Exception as exc:
        logger.warning("Cannot initialise ChromaKnowledgeIndex: %s — falling back to legacy.", exc)
        return None


@lru_cache(maxsize=1)
def get_knowledge_index() -> KnowledgeIndex:
    """Return the best available knowledge index (singleton)."""
    global KnowledgeIndex
    root = Path(get_settings().interview_knowledge_base_dir)
    chroma_idx = _create_chroma_index(root)
    if chroma_idx is not None:
        KnowledgeIndex = ChromaKnowledgeIndex  # noqa: F811 — intentional rebind
        return chroma_idx
    return LegacyKnowledgeIndex(root)


def reload_knowledge_index() -> dict[str, Any]:
    idx = get_knowledge_index()
    idx.reload()
    return idx.status()
