"""PDF document text extraction service using PyMuPDF.

Extracts text page-by-page while preserving page boundaries and structure.
Fails explicitly if the document contains no extractable text (e.g. empty or scanned images without text layer).
No external network calls are performed at import time.
"""

import logging
from dataclasses import dataclass

import pymupdf

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExtractedPage:
    """Represents text extracted from a single page of a document."""

    page_number: int  # 1-indexed
    text: str


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> list[ExtractedPage]:
    """Extract page-aware text from PDF binary data using PyMuPDF.

    Args:
        pdf_bytes: Raw bytes of the PDF file.

    Returns:
        List of ExtractedPage objects with page numbers and text.

    Raises:
        ValueError: If PDF is empty, unreadable, or has no extractable text.
    """
    if not pdf_bytes:
        raise ValueError("Cannot extract text from empty document bytes")

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        logger.error("Failed to open PDF with PyMuPDF: %s", type(exc).__name__)
        raise ValueError(f"Failed to read PDF document: {exc}") from exc

    try:
        page_count = len(doc)
        if page_count == 0:
            raise ValueError("PDF document has 0 pages")

        extracted_pages: list[ExtractedPage] = []
        total_extracted_chars = 0

        for page_idx in range(page_count):
            page = doc[page_idx]
            page_text = page.get_text("text").strip()
            if page_text:
                total_extracted_chars += len(page_text)
                extracted_pages.append(
                    ExtractedPage(
                        page_number=page_idx + 1,
                        text=page_text,
                    )
                )

        if not extracted_pages or total_extracted_chars == 0:
            raise ValueError(
                "PDF contains no extractable text. It may contain only scanned images or non-standard font encodings."
            )

        logger.info(
            "Extracted text from %d / %d pages (%d characters total)",
            len(extracted_pages),
            page_count,
            total_extracted_chars,
        )
        return extracted_pages

    finally:
        doc.close()
