"""Deterministic text chunking service for Maritime Nexus RAG pipeline.

Splits page-aware document text into ordered, overlapping chunks while
preserving paragraph coherence, document order, and page metadata.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from backend.core.config import settings
from backend.services.extraction import ExtractedPage

logger = logging.getLogger(__name__)


@dataclass
class DocumentChunkData:
    """In-memory representation of a chunk before database persistence."""

    chunk_index: int
    content: str
    page_number: int | None
    token_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


def _split_into_paragraphs(text: str) -> list[str]:
    """Split text on paragraph breaks (double newlines or list items)."""
    raw_paras = re.split(r"\n\s*\n", text)
    cleaned = []
    for p in raw_paras:
        p_clean = p.strip()
        if p_clean:
            cleaned.append(p_clean)
    return cleaned


def _split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    """Split an oversized paragraph into smaller sentence-level or whitespace pieces."""
    # Split by sentence boundaries (. followed by space, or newline)
    sentences = re.split(r"(?<=[.?!])\s+|\n+", paragraph)
    pieces: list[str] = []
    current = ""

    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(current) + len(s) + 1 <= max_chars:
            current = f"{current} {s}" if current else s
        else:
            if current:
                pieces.append(current)
            if len(s) > max_chars:
                # If a single sentence exceeds max_chars, split on word boundaries
                words = s.split()
                w_current = ""
                for w in words:
                    if len(w_current) + len(w) + 1 <= max_chars:
                        w_current = f"{w_current} {w}" if w_current else w
                    else:
                        if w_current:
                            pieces.append(w_current)
                        w_current = w
                if w_current:
                    pieces.append(w_current)
                current = ""
            else:
                current = s

    if current:
        pieces.append(current)

    return pieces


def chunk_extracted_pages(
    pages: list[ExtractedPage],
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[DocumentChunkData]:
    """Chunk extracted document pages into ordered, overlapping segments.

    Args:
        pages: List of ExtractedPage from PDF extraction.
        chunk_size: Maximum character length per chunk (default from Settings).
        chunk_overlap: Overlap character length between chunks (default from Settings).

    Returns:
        List of DocumentChunkData with sequential chunk_index and page attribution.
    """
    target_size = chunk_size or settings.RAG_CHUNK_SIZE
    target_overlap = chunk_overlap or settings.RAG_CHUNK_OVERLAP

    if target_overlap >= target_size:
        target_overlap = target_size // 5

    chunks: list[DocumentChunkData] = []
    chunk_idx = 0

    # Accumulate across pages while tracking the primary page number
    current_text = ""
    current_page: int | None = None

    for page in pages:
        paragraphs = _split_into_paragraphs(page.text)

        for para in paragraphs:
            sub_pieces = _split_long_paragraph(para, target_size)

            for piece in sub_pieces:
                if not current_text:
                    current_text = piece
                    current_page = page.page_number
                elif len(current_text) + len(piece) + 2 <= target_size:
                    current_text = f"{current_text}\n\n{piece}"
                else:
                    # Emit current chunk
                    trimmed = current_text.strip()
                    if trimmed:
                        token_estimate = max(1, len(trimmed) // 4)
                        chunks.append(
                            DocumentChunkData(
                                chunk_index=chunk_idx,
                                content=trimmed,
                                page_number=current_page,
                                token_count=token_estimate,
                                metadata={"char_count": len(trimmed), "page": current_page},
                            )
                        )
                        chunk_idx += 1

                    # Compute overlap from the end of current_text
                    if target_overlap > 0 and len(current_text) > target_overlap:
                        overlap_tail = current_text[-target_overlap:].strip()
                        # Find first word boundary in the overlap tail
                        first_space = overlap_tail.find(" ")
                        if first_space != -1:
                            overlap_tail = overlap_tail[first_space + 1 :].strip()
                        current_text = f"{overlap_tail}\n\n{piece}" if overlap_tail else piece
                    else:
                        current_text = piece

                    current_page = page.page_number

    # Emit any remaining text in the buffer
    if current_text.strip():
        trimmed = current_text.strip()
        token_estimate = max(1, len(trimmed) // 4)
        chunks.append(
            DocumentChunkData(
                chunk_index=chunk_idx,
                content=trimmed,
                page_number=current_page,
                token_count=token_estimate,
                metadata={"char_count": len(trimmed), "page": current_page},
            )
        )

    logger.info("Generated %d chunks from %d pages", len(chunks), len(pages))
    return chunks
