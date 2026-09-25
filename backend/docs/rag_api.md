# Maritime Nexus — RAG & Question Answering API Documentation

## Overview

Maritime Nexus provides a grounded Question-Answering (Q&A) pipeline built on:
- **Retrieval**: BGE-M3 (1024-dim dense embeddings) via pgvector cosine similarity search.
- **Generation**: Gemma 3:1B (configurable via `QWEN_MODEL`) via local Ollama instance with strict grounding instructions.
- **Multi-Tenant Security**: Context chunks are strictly filtered by the authenticated user's organization.

---

## Endpoint: Grounded Question Answering

### `POST /api/v1/rag/ask`

Answers natural-language questions strictly using relevant document chunks from the user's organization.

#### Authentication
- **Requirement**: Valid Firebase ID Token in `Authorization` header.
- **Header**: `Authorization: Bearer <FIREBASE_ID_TOKEN>`

#### Request Body
```json
{
  "query": "What are the main terms and conditions of this charter party?",
  "top_k": 5,
  "document_id": "optional-document-uuid-filter"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Natural-language question (1–2000 characters, whitespace trimmed). |
| `top_k` | integer | No | Number of top chunks to retrieve (1–20, default: 5). |
| `document_id` | UUID | No | Optional UUID to restrict search to a single document. |

#### Response (`HTTP 200 OK`)
```json
{
  "answer": "According to Gencon_Charter_Party.pdf (Page 3), demurrage is agreed at USD 15,000 per day or pro rata...",
  "sources": [
    {
      "document_id": "c71e8a93-79d1-4db8-9ce3-d2d0c242e20b",
      "chunk_id": "8f3d1b22-a6f4-4a5c-9c17-91a6d4e5f7b8",
      "document_title": "Gencon_Charter_Party.pdf",
      "page_number": 3,
      "score": 0.9124
    }
  ]
}
```

#### Grounding Behavior
- **Strict Context Boundary**: Grounded answers using **only** facts present in the retrieved chunks.
- **No Hallucinations**: When the context lacks enough information to answer, the model responds:
  `"No relevant information was found in the uploaded documents."`
- **Zero-Match Short-Circuit**: If vector search retrieves 0 chunks, the API returns immediately with `"No relevant information was found in the uploaded documents."` without invoking the LLM.

#### Error Responses
| Status Code | Reason |
|---|---|
| `401 Unauthorized` | Missing or expired Firebase ID token. |
| `403 Forbidden` | User is not assigned to an active organization (`"Organization access required"`). |
| `422 Unprocessable Entity` | Empty query or invalid `top_k` (must be between 1 and 20). |
| `503 Service Unavailable` | Ollama service is unreachable or requested model is missing. |
| `504 Gateway Timeout` | LLM generation exceeded `OLLAMA_LLM_TIMEOUT_SECONDS` (default: 120s). |
| `500 Internal Server Error` | Unexpected database or internal processing failure. |
