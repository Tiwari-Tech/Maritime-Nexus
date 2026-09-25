"""LLM service communicating with Ollama for grounded answer generation (default Gemma 3:1B).

Constructs strictly grounded prompts and generates answers using local Ollama instance.
No external network calls are made at module import time.
"""

import logging
import re
import time

import httpx

from backend.core.config import settings
from backend.services.retrieval import SearchResultItem

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Maritime Nexus Copilot, an AI assistant specialized in maritime operations, charter parties, and contracts.

CRITICAL INSTRUCTIONS:
1. Grounding: Answer the user's question strictly using ONLY the supplied Context Chunks below. Do not use outside knowledge.
2. No Guessing: Do not assume, extrapolate, or introduce external facts not present in the context. Do not infer contractual facts that are absent from the supplied context.
3. Insufficient Information: If the supplied context does not contain enough information to answer the question, explicitly state: "No relevant information was found in the uploaded documents."
4. Conciseness & Directness: Provide a clear, professional, and well-structured answer directly addressing the question.
5. Attribution: When stating facts, refer to the source document title and page number where available."""


def build_grounded_prompt(query: str, chunks: list[SearchResultItem]) -> tuple[str, str]:
    """Construct a grounded prompt containing the query and retrieved context chunks.

    Returns:
        (system_prompt, user_prompt)
    """
    context_parts = []
    for idx, chunk in enumerate(chunks, 1):
        page_info = f"Page {chunk.page_number}" if chunk.page_number else f"Chunk {chunk.chunk_index}"
        doc_title = chunk.document_title or "Document"
        context_parts.append(
            f'[Source {idx}: "{doc_title}" ({page_info})]\n{chunk.content}'
        )

    context_text = "\n\n".join(context_parts)

    user_prompt = f"""CONTEXT CHUNKS:
{context_text}

---
QUESTION:
{query.strip()}

ANSWER:"""

    return SYSTEM_PROMPT, user_prompt


_llm_client: httpx.Client | None = None


def _get_llm_client(base_url: str, timeout_seconds: float) -> httpx.Client:
    """Return a persistent HTTP client with connection pooling for Ollama LLM requests."""
    global _llm_client
    if (
        _llm_client is None
        or _llm_client.is_closed
        or str(_llm_client.base_url).rstrip("/") != base_url
        or _llm_client.timeout.read != timeout_seconds
    ):
        if _llm_client is not None and not _llm_client.is_closed:
            _llm_client.close()
        _llm_client = httpx.Client(
            base_url=base_url,
            timeout=timeout_seconds,
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )
    return _llm_client


def generate_grounded_answer(
    query: str,
    chunks: list[SearchResultItem],
    timings: dict[str, float] | None = None,
) -> str:
    """Call configured LLM (default Gemma 3:1B) through Ollama to generate a grounded answer from context chunks.

    Args:
        query: User's natural language question.
        chunks: Retrieved relevant document chunks.
        timings: Optional dictionary to record diagnostic prompt and LLM durations.

    Returns:
        Generated answer text from LLM.

    Raises:
        RuntimeError: If Ollama is unreachable or model is missing.
        TimeoutError: If generation times out.
    """
    if not chunks:
        if timings is not None:
            timings["prompt"] = 0.0
            timings["llm"] = 0.0
        return "No relevant information was found in the uploaded documents."

    t_prompt_start = time.perf_counter()
    system_prompt, user_prompt = build_grounded_prompt(query, chunks)
    t_prompt_end = time.perf_counter()
    if timings is not None:
        timings["prompt"] = t_prompt_end - t_prompt_start

    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    model_name = settings.QWEN_MODEL
    timeout_seconds = float(settings.OLLAMA_LLM_TIMEOUT_SECONDS)

    chunk_lens = [len(c.content) if c.content else 0 for c in chunks]
    total_context_chars = sum(chunk_lens)
    has_empty = any(l == 0 for l in chunk_lens)

    logger.info(
        "RAG context: chunks=%d total_chars=%d chunk_lengths=%s has_empty=%s",
        len(chunks),
        total_context_chars,
        chunk_lens,
        has_empty,
    )
    logger.info(
        "Generating answer using Ollama model '%s' with %d context chunks",
        model_name,
        len(chunks),
    )

    t_llm_start = time.perf_counter()
    client = _get_llm_client(base_url, timeout_seconds)
    try:
        # Try /api/chat first (standard for chat-instruct models)
        resp = client.post(
            "/api/chat",
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
                "think": False,
                "options": {
                    "temperature": 0.1,  # Low temperature for factual precision
                    "num_predict": settings.OLLAMA_NUM_PREDICT,
                },
            },
        )

        if resp.status_code == 200:
            data = resp.json()
            message = data.get("message", {})
            content = message.get("content", "").strip()
            content = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
            if not content:
                raise RuntimeError("Ollama returned an empty generation response")
            if timings is not None:
                timings["llm"] = time.perf_counter() - t_llm_start
            return content

        # If /api/chat is 404, fall back to /api/generate
        if resp.status_code == 404:
            logger.info("/api/chat not found, falling back to /api/generate")
            gen_resp = client.post(
                "/api/generate",
                json={
                    "model": model_name,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "stream": False,
                    "think": False,
                    "options": {
                        "temperature": 0.1,
                        "num_predict": settings.OLLAMA_NUM_PREDICT,
                    },
                },
            )
            if gen_resp.status_code == 200:
                data = gen_resp.json()
                content = data.get("response", "").strip()
                content = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
                if not content:
                    raise RuntimeError("Ollama returned an empty generation response")
                if timings is not None:
                    timings["llm"] = time.perf_counter() - t_llm_start
                return content

        # Check for model not found
        if "model" in resp.text and ("not found" in resp.text or resp.status_code == 404):
            raise RuntimeError(
                f"LLM model '{model_name}' was not found in Ollama. "
                f"Please pull it using: ollama pull {model_name}"
            )

        raise RuntimeError(
            f"Ollama LLM generation error (HTTP {resp.status_code}): {resp.text}"
        )

    except httpx.ConnectError as exc:
        if timings is not None and "llm" not in timings:
            timings["llm"] = time.perf_counter() - t_llm_start
        logger.error("Failed to connect to Ollama at %s: %s", base_url, exc)
        raise RuntimeError(
            f"Ollama service at {base_url} is unreachable. Ensure Ollama is running."
        ) from exc
    except httpx.TimeoutException as exc:
        if timings is not None and "llm" not in timings:
            timings["llm"] = time.perf_counter() - t_llm_start
        logger.error("Timeout waiting for Ollama generation after %ds", timeout_seconds)
        raise TimeoutError(
            f"Ollama generation timed out after {timeout_seconds} seconds."
        ) from exc
    except Exception:
        if timings is not None and "llm" not in timings:
            timings["llm"] = time.perf_counter() - t_llm_start
        raise
