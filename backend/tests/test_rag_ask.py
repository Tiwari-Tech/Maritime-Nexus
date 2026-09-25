"""Automated tests for RAG question answering endpoint."""

import logging
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import status
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_org, get_current_user
from backend.db.session import get_db
from backend.main import app
from backend.models.organization import Organization, User
from backend.schemas.auth import UserRole
from backend.services.retrieval import SearchResultItem

client = TestClient(app)


def test_unauthenticated_rag_ask():
    """Unauthenticated request to /api/v1/rag/ask must be rejected with 401."""
    res = client.post(
        "/api/v1/rag/ask",
        json={"query": "What are the laytime terms?"},
    )
    assert res.status_code == status.HTTP_401_UNAUTHORIZED


def test_user_without_org_rag_ask():
    """User without an organization must receive 403 Forbidden."""
    user_no_org = User(
        id=uuid.uuid4(),
        firebase_uid="uid_no_org",
        email="no_org@maritime-nexus.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(timezone.utc),
    )

    app.dependency_overrides[get_current_user] = lambda: user_no_org
    try:
        res = client.post(
            "/api/v1/rag/ask",
            json={"query": "What are the laytime terms?"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()


def test_rag_ask_no_retrieval_results():
    """When no matching chunks are found, returns a clear response without calling LLM."""
    org_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org",
        email="org_user@maritime-nexus.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Test Shipping Org",
        slug="test-shipping-org",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        with (
            patch("backend.api.routes.rag.search_document_chunks", return_value=[]) as mock_search,
            patch("backend.api.routes.rag.generate_grounded_answer") as mock_generate,
        ):
            res = client.post(
                "/api/v1/rag/ask",
                json={"query": "Non-existent clause query", "top_k": 3},
            )
            assert res.status_code == status.HTTP_200_OK
            data = res.json()
            assert data["answer"] == "No relevant information was found in the uploaded documents."
            assert data["sources"] == []
            mock_search.assert_called_once()
            mock_generate.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_rag_ask_ollama_failure():
    """When Ollama fails with an infrastructure error, returns 503 Service Unavailable."""
    org_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org",
        email="org_user@maritime-nexus.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Test Shipping Org",
        slug="test-shipping-org",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Charter_Party.pdf",
        chunk_index=0,
        page_number=1,
        content="Laytime shall be 72 running hours weather permitting.",
        similarity_score=0.88,
        metadata={},
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        with (
            patch("backend.api.routes.rag.search_document_chunks", return_value=[dummy_chunk]),
            patch(
                "backend.api.routes.rag.generate_grounded_answer",
                side_effect=RuntimeError("Ollama service unreachable"),
            ),
        ):
            res = client.post(
                "/api/v1/rag/ask",
                json={"query": "What is the laytime?"},
            )
            assert res.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
            assert "Ollama service unreachable" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_rag_ask_ollama_timeout():
    """When Ollama generation times out, returns 504 Gateway Timeout."""
    org_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org",
        email="org_user@maritime-nexus.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Test Shipping Org",
        slug="test-shipping-org",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Charter_Party.pdf",
        chunk_index=0,
        page_number=1,
        content="Laytime shall be 72 running hours weather permitting.",
        similarity_score=0.88,
        metadata={},
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        with (
            patch("backend.api.routes.rag.search_document_chunks", return_value=[dummy_chunk]),
            patch(
                "backend.api.routes.rag.generate_grounded_answer",
                side_effect=TimeoutError("Ollama generation timed out after 120 seconds."),
            ),
        ):
            res = client.post(
                "/api/v1/rag/ask",
                json={"query": "What is the laytime?"},
            )
            assert res.status_code == status.HTTP_504_GATEWAY_TIMEOUT
            assert "timed out" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_rag_ask_success():
    """Successful Q&A returns grounded answer and verifiable source references."""
    org_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org",
        email="org_user@maritime-nexus.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Test Shipping Org",
        slug="test-shipping-org",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    doc_id = uuid.uuid4()
    chunk_id = uuid.uuid4()
    dummy_chunk = SearchResultItem(
        chunk_id=chunk_id,
        document_id=doc_id,
        document_title="Gencon_Charter_Party.pdf",
        chunk_index=2,
        page_number=3,
        content="Demurrage is agreed at USD 15,000 per day or pro rata.",
        similarity_score=0.92,
        metadata={"char_count": 55},
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    expected_answer = "According to Gencon_Charter_Party.pdf (Page 3), demurrage is set at USD 15,000 per day or pro rata."

    try:
        with (
            patch("backend.api.routes.rag.search_document_chunks", return_value=[dummy_chunk]) as mock_search,
            patch(
                "backend.api.routes.rag.generate_grounded_answer",
                return_value=expected_answer,
            ) as mock_generate,
        ):
            res = client.post(
                "/api/v1/rag/ask",
                json={"query": "What is the agreed demurrage rate?", "top_k": 3},
            )
            assert res.status_code == status.HTTP_200_OK
            data = res.json()
            assert data["answer"] == expected_answer
            assert len(data["sources"]) == 1
            src = data["sources"][0]
            assert src["document_id"] == str(doc_id)
            assert src["chunk_id"] == str(chunk_id)
            assert src["document_title"] == "Gencon_Charter_Party.pdf"
            assert src["page_number"] == 3
            assert src["score"] == 0.92

            mock_search.assert_called_once()
            assert mock_generate.call_args[0] == ("What is the agreed demurrage rate?", [dummy_chunk])
    finally:
        app.dependency_overrides.clear()


def test_generate_grounded_answer_payload_disables_thinking():
    """Verify that generate_grounded_answer sends think=False and num_predict to Ollama."""
    from backend.services.llm import generate_grounded_answer

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Test.pdf",
        chunk_index=0,
        page_number=1,
        content="Notice of Readiness shall be tendered within working hours.",
        similarity_score=0.9,
        metadata={},
    )

    with patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "message": {
                "role": "assistant",
                "content": "<think>internal reasoning</think>Notice of Readiness must be tendered within working hours.",
            }
        }
        mock_post.return_value = mock_response

        answer = generate_grounded_answer("When to tender NOR?", [dummy_chunk])

        # Assert thinking tokens are stripped
        assert answer == "Notice of Readiness must be tendered within working hours."

        # Assert Ollama call payload
        mock_post.assert_called_once()
        called_url, called_kwargs = mock_post.call_args
        assert called_url[0] == "/api/chat"
        payload = called_kwargs["json"]
        assert payload["model"] == "gemma3:1b"
        assert payload["think"] is False
        assert payload["options"]["temperature"] == 0.1
        assert payload["options"]["num_predict"] == 512


def test_generate_grounded_answer_fallback_payload_disables_thinking():
    """Verify that fallback /api/generate also sends think=False and num_predict."""
    from backend.services.llm import generate_grounded_answer

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Test.pdf",
        chunk_index=0,
        page_number=1,
        content="Notice of Readiness shall be tendered within working hours.",
        similarity_score=0.9,
        metadata={},
    )

    with patch("httpx.Client.post") as mock_post:
        resp_404 = MagicMock(status_code=404, text="Not Found")
        resp_200 = MagicMock(
            status_code=200,
            json=lambda: {"response": "<think>reasoning</think>Notice of Readiness details."},
        )
        mock_post.side_effect = [resp_404, resp_200]

        answer = generate_grounded_answer("When to tender NOR?", [dummy_chunk])

        assert answer == "Notice of Readiness details."
        assert mock_post.call_count == 2
        gen_url, gen_kwargs = mock_post.call_args_list[1]
        assert gen_url[0] == "/api/generate"
        gen_payload = gen_kwargs["json"]
        assert gen_payload["model"] == "gemma3:1b"
        assert gen_payload["think"] is False
        assert gen_payload["options"]["temperature"] == 0.1
        assert gen_payload["options"]["num_predict"] == 512


def test_rag_ask_organization_isolation():
    """Verify that retrieval is strictly scoped to the authenticated organization."""
    org_id = uuid.uuid4()
    foreign_doc_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org_user",
        email="org_user@maritime-nexus.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Org A",
        slug="org-a",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        with patch("backend.api.routes.rag.search_document_chunks", return_value=[]) as mock_search:
            res = client.post(
                "/api/v1/rag/ask",
                json={
                    "query": "Laytime details in foreign doc?",
                    "document_id": str(foreign_doc_id),
                },
            )
            assert res.status_code == status.HTTP_200_OK
            assert res.json() == {
                "answer": "No relevant information was found in the uploaded documents.",
                "sources": [],
            }
            # Verify organization_id was enforced
            mock_search.assert_called_once()
            _, kwargs = mock_search.call_args
            assert kwargs["organization_id"] == org_id
            assert kwargs["document_id"] == foreign_doc_id
    finally:
        app.dependency_overrides.clear()


def test_rag_ask_timing_instrumentation(caplog):
    """Verify that timing and retrieval metadata are logged on /api/v1/rag/ask requests."""
    org_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org_user",
        email="org_user@maritime-nexus.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_id,
        created_at=datetime.now(timezone.utc),
    )
    org = Organization(
        id=org_id,
        name="Org A",
        slug="org-a",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Charter.pdf",
        chunk_index=0,
        page_number=1,
        content="Laytime terms.",
        similarity_score=0.85,
        metadata={},
    )

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_org] = lambda: org
    app.dependency_overrides[get_db] = lambda: MagicMock()

    try:
        with (
            caplog.at_level(logging.INFO),
            patch("backend.api.routes.rag.search_document_chunks", return_value=[dummy_chunk]),
            patch("backend.api.routes.rag.generate_grounded_answer", return_value="Laytime is 72 hours."),
        ):
            res = client.post(
                "/api/v1/rag/ask",
                json={"query": "Laytime?"},
            )
            assert res.status_code == status.HTTP_200_OK
            assert res.json()["answer"] == "Laytime is 72 hours."
            assert len(res.json()["sources"]) == 1

            # Assert timing and retrieval log messages
            log_text = caplog.text
            assert "RAG retrieval: chunks=1 scores=[0.85]" in log_text
            assert "RAG ask timings:" in log_text
            assert "embedding=" in log_text
            assert "retrieval=" in log_text
            assert "prompt=" in log_text
            assert "llm=" in log_text
            assert "total=" in log_text
    finally:
        app.dependency_overrides.clear()


def test_llm_model_configurable():
    """Verify that settings.QWEN_MODEL defaults to gemma3:1b and is dynamically configurable."""
    from backend.core.config import settings
    from backend.services.llm import generate_grounded_answer

    assert settings.QWEN_MODEL == "gemma3:1b"

    dummy_chunk = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Test.pdf",
        chunk_index=0,
        page_number=1,
        content="Laytime terms.",
        similarity_score=0.9,
        metadata={},
    )

    with patch("httpx.Client.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"role": "assistant", "content": "Grounded answer."}},
        )

        with patch.object(settings, "QWEN_MODEL", "custom-model:latest"):
            generate_grounded_answer("Query?", [dummy_chunk])
            called_url, called_kwargs = mock_post.call_args
            assert called_kwargs["json"]["model"] == "custom-model:latest"


def test_chunk_text_propagated_to_llm_context():
    """Verify that search_document_chunks text is completely passed to the LLM prompt."""
    from backend.services.llm import build_grounded_prompt, generate_grounded_answer

    chunk1 = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Resume.pdf",
        chunk_index=0,
        page_number=1,
        content="Candidate Name: Jane Doe | Email: jane.doe@maritime.com",
        similarity_score=0.88,
        metadata={},
    )
    chunk2 = SearchResultItem(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Resume.pdf",
        chunk_index=1,
        page_number=1,
        content="Skills: Python, FastAPI, Maritime Logistical Architecture",
        similarity_score=0.81,
        metadata={},
    )

    sys_prompt, user_prompt = build_grounded_prompt("What is Jane's email?", [chunk1, chunk2])

    # Assert structure and text presence
    assert "Candidate Name: Jane Doe | Email: jane.doe@maritime.com" in user_prompt
    assert "Skills: Python, FastAPI, Maritime Logistical Architecture" in user_prompt
    assert '[Source 1: "Resume.pdf" (Page 1)]' in user_prompt
    assert '[Source 2: "Resume.pdf" (Page 1)]' in user_prompt
    assert "QUESTION:\nWhat is Jane's email?" in user_prompt

    # Also assert through generate_grounded_answer HTTP call
    with patch("httpx.Client.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"role": "assistant", "content": "jane.doe@maritime.com"}},
        )
        generate_grounded_answer("What is Jane's email?", [chunk1, chunk2])
        mock_post.assert_called_once()
        sent_messages = mock_post.call_args[1]["json"]["messages"]
        assert sent_messages[0]["role"] == "system"
        assert sent_messages[1]["role"] == "user"
        sent_user_content = sent_messages[1]["content"]
        assert "Candidate Name: Jane Doe | Email: jane.doe@maritime.com" in sent_user_content
        assert "Skills: Python, FastAPI, Maritime Logistical Architecture" in sent_user_content




