"""Tests validating backend performance optimizations and regression prevention."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from google.cloud.exceptions import NotFound

from backend.api.dependencies import get_current_org
from backend.models.document_chunk import DocumentChunk
from backend.models.organization import Organization, User
from backend.schemas.auth import UserRole
from backend.services.chunking import _split_long_paragraph
from backend.services.embedding import (
    _get_embedding_client,
    get_batch_embeddings,
)
from backend.services.llm import _get_llm_client
from backend.services.retrieval import search_document_chunks
from backend.services.storage import download_document_bytes


def test_split_long_paragraph_word_accumulation():
    """Verify that oversized sentence splitting accumulates words linearly without word loss."""
    words = ["maritime", "cargo", "vessel", "charter", "demurrage", "laytime", "dispatch", "berth"]
    long_sentence = " ".join(words * 15)  # 120 words
    max_chars = 100

    pieces = _split_long_paragraph(long_sentence, max_chars)

    # Every piece must be <= max_chars
    for piece in pieces:
        assert len(piece) <= max_chars

    # All original words must be preserved in order
    reconstructed_words = " ".join(pieces).split()
    assert reconstructed_words == long_sentence.split()


def test_embedding_client_reuse():
    """Verify that _get_embedding_client returns a persistent reusable client instance."""
    client1 = _get_embedding_client("http://localhost:11434")
    client2 = _get_embedding_client("http://localhost:11434")
    assert client1 is client2
    assert not client1.is_closed


def test_llm_client_reuse():
    """Verify that _get_llm_client returns a persistent reusable client instance."""
    client1 = _get_llm_client("http://localhost:11434", 120.0)
    client2 = _get_llm_client("http://localhost:11434", 120.0)
    assert client1 is client2
    assert not client1.is_closed


def test_batch_embeddings_bounded_partitioning():
    """Verify that get_batch_embeddings partitions large inputs into bounded batches of 32."""
    dummy_vector = [0.1] * 1024
    num_texts = 75  # Should split into 32 + 32 + 11 = 3 batches
    texts = [f"Text chunk {i}" for i in range(num_texts)]

    mock_client = MagicMock()

    def mock_post(url, **kwargs):
        payload_input = kwargs.get("json", {}).get("input", [])
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"embeddings": [dummy_vector] * len(payload_input)}
        return resp

    mock_client.post.side_effect = mock_post

    with patch("backend.services.embedding._get_embedding_client", return_value=mock_client):
        embeddings = get_batch_embeddings(texts)

        assert len(embeddings) == num_texts
        assert mock_client.post.call_count == 3
        # Verify batch sizes
        batch_sizes = [call[1]["json"]["input"] for call in mock_client.post.call_args_list]
        assert len(batch_sizes[0]) == 32
        assert len(batch_sizes[1]) == 32
        assert len(batch_sizes[2]) == 11


def test_get_current_org_fast_path_zero_queries():
    """When User.organization is eagerly loaded and active, get_current_org avoids querying the database."""
    org_id = uuid.uuid4()
    org = Organization(
        id=org_id,
        name="Fast Path Org",
        slug="fast-path-org",
        is_active=True,
    )
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_fast_path",
        email="fast@maritime-nexus.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_id,
    )
    # Simulate eager loading: relationship is populated on the model
    user.organization = org

    mock_db = MagicMock()

    resolved_org = get_current_org(current_user=user, db=mock_db)

    assert resolved_org is org
    # Zero queries executed on the database session
    mock_db.query.assert_not_called()


def test_storage_download_not_found_handling():
    """Verify that download_document_bytes catches NotFound and raises FileNotFoundError directly."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()
    mock_blob.download_as_bytes.side_effect = NotFound("Blob not found")
    mock_bucket.blob.return_value = mock_blob
    mock_client.bucket.return_value = mock_bucket

    with (
        patch("backend.services.storage.get_storage_client", return_value=mock_client),
        patch("backend.services.storage.settings.GCS_BUCKET_NAME", "test-bucket"),
        pytest.raises(FileNotFoundError),
    ):
        download_document_bytes("missing_blob.pdf")


def test_search_document_chunks_excludes_embedding_column():
    """Verify that search_document_chunks projects only scalar columns, excluding DocumentChunk.embedding."""
    org_id = uuid.uuid4()
    mock_db = MagicMock()
    query_chain = MagicMock()
    mock_db.query.return_value = query_chain
    query_chain.join.return_value = query_chain
    query_chain.filter.return_value = query_chain
    query_chain.order_by.return_value = query_chain
    query_chain.limit.return_value = query_chain
    query_chain.all.return_value = []

    with patch("backend.services.retrieval.get_query_embedding", return_value=[0.1] * 1024):
        search_document_chunks("test query", org_id, mock_db)

        # Inspect entities passed to db.query(...)
        queried_entities = mock_db.query.call_args[0]
        # DocumentChunk.embedding must NOT be in the projected query columns
        assert DocumentChunk.embedding not in queried_entities
        assert DocumentChunk.id in queried_entities
        assert DocumentChunk.content in queried_entities
        assert DocumentChunk.chunk_index in queried_entities
