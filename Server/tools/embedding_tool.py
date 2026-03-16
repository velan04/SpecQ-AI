"""Embedding Tool — optional semantic similarity helper using sentence-transformers.
Used to pre-score testcase↔description pairs before sending to the LLM comparator.
Falls back gracefully if sentence-transformers is not installed.
"""
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

_model = None


def _load_model():
    global _model
    if _model is not None:
        return _model
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Sentence-transformer model loaded.")
    except ImportError:
        logger.info("sentence-transformers not installed — embedding tool disabled.")
        _model = False
    return _model


def compute_similarity(text_a: str, text_b: str) -> float:
    """Return cosine similarity [0..1] between two texts. Returns -1 if unavailable."""
    model = _load_model()
    if not model:
        return -1.0
    try:
        from sklearn.metrics.pairwise import cosine_similarity
        import numpy as np
        emb = model.encode([text_a, text_b])
        score = float(cosine_similarity([emb[0]], [emb[1]])[0][0])
        return round(score, 4)
    except Exception as e:
        logger.warning(f"Embedding similarity failed: {e}")
        return -1.0


def rank_matches(
    query: str,
    candidates: List[str],
    top_k: int = 5,
) -> List[Tuple[int, float]]:
    """
    Return top_k (index, score) pairs from candidates most similar to query.
    Falls back to [(i, -1.0) for i in range(min(top_k, len(candidates)))] if unavailable.
    """
    model = _load_model()
    if not model:
        return [(i, -1.0) for i in range(min(top_k, len(candidates)))]
    try:
        from sklearn.metrics.pairwise import cosine_similarity
        embeddings = model.encode([query] + candidates)
        q_emb = embeddings[0:1]
        c_embs = embeddings[1:]
        scores = cosine_similarity(q_emb, c_embs)[0]
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        return [(int(i), float(s)) for i, s in ranked[:top_k]]
    except Exception as e:
        logger.warning(f"rank_matches failed: {e}")
        return [(i, -1.0) for i in range(min(top_k, len(candidates)))]
