"""BGE-M3 embedding service communicating with local Ollama instance.

Generates dense 1024-dimensional embeddings for chunks and search queries.
No network calls are made at module import time.
"""

import logging
from typing import Any

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)


def _validate_embedding_dimension(vec: list[float], expected_dim: int) -> None:
    """Ensure the returned vector matches the configured pgvector dimension."""
    actual_dim = len(vec)
    if actual_dim != expected_dim:
        raise ValueError(
            f"Embedding dimension mismatch: expected {expected_dim}, got {actual_dim} from model '{settings.EMBEDDING_MODEL}'."
        )


def get_batch_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate dense embeddings for a list of texts using the configured Ollama BGE-M3 model.

    Args:
        texts: Non-empty list of text strings to embed.

    Returns:
        List of 1024-dimensional float vectors matching the input order.

    Raises:
        RuntimeError: If Ollama is unreachable, model is missing, or returns an error.
        ValueError: If returned vector dimension does not match settings.EMBEDDING_DIMENSION.
    """
    if not texts:
        return []

    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    model_name = settings.EMBEDDING_MODEL
    expected_dim = settings.EMBEDDING_DIMENSION

    # Try modern Ollama /api/embed batch endpoint first
    try:
        with httpx.Client(base_url=base_url, timeout=120.0) as client:
            resp = client.post(
                "/api/embed",
                json={"model": model_name, "input": texts},
            )

            if resp.status_code == 200:
                data = resp.json()
                embeddings: list[list[float]] = data.get("embeddings", [])
                if len(embeddings) != len(texts):
                    raise RuntimeError(
                        f"Ollama returned {len(embeddings)} embeddings for {len(texts)} inputs."
                    )
                for emb in embeddings:
                    _validate_embedding_dimension(emb, expected_dim)
                return embeddings

            # If /api/embed is not found (older Ollama), fall back to /api/embeddings per item
            if resp.status_code == 404:
                logger.info("Ollama /api/embed returned 404, falling back to /api/embeddings loop")
                embeddings = []
                for text in texts:
                    single_resp = client.post(
                        "/api/embeddings",
                        json={"model": model_name, "prompt": text},
                    )
                    if single_resp.status_code != 200:
                        raise RuntimeError(
                            f"Ollama /api/embeddings returned HTTP {single_resp.status_code}: {single_resp.text}"
                        )
                    emb = single_resp.json().get("embedding", [])
                    _validate_embedding_dimension(emb, expected_dim)
                    embeddings.append(emb)
                return embeddings

            # Handle model not found error
            if "model" in resp.text and ("not found" in resp.text or resp.status_code == 404):
                raise RuntimeError(
                    f"Embedding model '{model_name}' was not found in Ollama. "
                    f"Please pull it using: ollama pull {model_name}"
                )

            raise RuntimeError(
                f"Ollama embedding service error (HTTP {resp.status_code}): {resp.text}"
            )

    except httpx.ConnectError as exc:
        logger.error("Failed to connect to Ollama at %s: %s", base_url, exc)
        raise RuntimeError(
            f"Ollama service at {base_url} is unreachable. Ensure Ollama is running."
        ) from exc
    except httpx.TimeoutException as exc:
        logger.error("Timeout waiting for Ollama embeddings from %s: %s", base_url, exc)
        raise RuntimeError(
            f"Timed out waiting for embeddings from Ollama at {base_url}."
        ) from exc


def get_query_embedding(query: str) -> list[float]:
    """Generate a single 1024-dimensional embedding for a natural language search query.

    Args:
        query: Query string to embed.

    Returns:
        1024-dimensional float vector.
    """
    clean_query = query.strip()
    if not clean_query:
        raise ValueError("Search query cannot be empty")

    results = get_batch_embeddings([clean_query])
    if not results:
        raise RuntimeError("No embedding generated for query")
    return results[0]
