"""Google Cloud Storage service for Maritime Nexus document management.

Handles secure, private document uploads, downloads via signed URLs, and deletions.
No network calls are made at module import time.
"""

import datetime
import logging
import os
import re
import uuid
from pathlib import Path

from google.cloud import storage
from google.cloud.exceptions import NotFound

from backend.core.config import settings

logger = logging.getLogger(__name__)

_storage_client: storage.Client | None = None


def get_storage_client() -> storage.Client:
    """Return a Google Cloud Storage client instance on demand (singleton).

    Uses Application Default Credentials or explicit GOOGLE_APPLICATION_CREDENTIALS.
    Never executes at module import time.
    """
    global _storage_client
    if _storage_client is None:
        if settings.GOOGLE_APPLICATION_CREDENTIALS and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS
        _storage_client = storage.Client()
    return _storage_client


def sanitize_filename(filename: str) -> str:
    """Sanitize client-provided filename to prevent path traversal and special character issues."""
    # Extract only the base name (eliminates ../, /foo, \bar)
    clean_name = Path(filename).name
    # Strip null bytes and path separators
    clean_name = clean_name.replace("/", "").replace("\\", "").replace("\0", "")
    # Replace any character other than alphanumeric, dash, underscore, and dot
    clean_name = re.sub(r"[^a-zA-Z0-9_\.\-]", "_", clean_name)
    # Collapse consecutive underscores
    clean_name = re.sub(r"_+", "_", clean_name)
    # Fallback if empty or hidden
    if not clean_name or clean_name.startswith("."):
        clean_name = f"document_{uuid.uuid4().hex[:8]}.pdf"
    return clean_name


def build_gcs_blob_name(organization_id: uuid.UUID, document_id: uuid.UUID, filename: str) -> str:
    """Construct a collision-safe, organization-scoped object path for GCS."""
    clean_filename = sanitize_filename(filename)
    return f"organizations/{organization_id}/documents/{document_id}/{clean_filename}"


def parse_blob_name_from_uri(gcs_uri: str) -> str:
    """Extract the relative blob name from a gs:// URI or return the path as-is."""
    if gcs_uri.startswith("gs://"):
        parts = gcs_uri[5:].split("/", 1)
        if len(parts) == 2:
            return parts[1]
    return gcs_uri


def upload_document_bytes(
    blob_name: str,
    file_bytes: bytes,
    content_type: str = "application/pdf",
) -> str:
    """Upload raw bytes to the configured private Google Cloud Storage bucket.

    Args:
        blob_name: The destination object path within the bucket.
        file_bytes: File contents to upload.
        content_type: MIME type of the file.

    Returns:
        The canonical gs:// URI of the uploaded object.
    """
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise RuntimeError("GCS_BUCKET_NAME is not configured in settings")

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    logger.info("Uploading document to GCS: gs://%s/%s (%d bytes)", bucket_name, blob_name, len(file_bytes))
    blob.upload_from_string(file_bytes, content_type=content_type)

    return f"gs://{bucket_name}/{blob_name}"


def download_document_bytes(blob_name: str) -> bytes:
    """Download raw bytes of a document object from the configured GCS bucket.

    Args:
        blob_name: The object path to download.

    Returns:
        Raw file bytes.

    Raises:
        FileNotFoundError: If the blob does not exist in GCS.
        RuntimeError: If GCS_BUCKET_NAME is not configured.
    """
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise RuntimeError("GCS_BUCKET_NAME is not configured in settings")

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    try:
        logger.info("Downloading document from GCS: gs://%s/%s", bucket_name, blob_name)
        return blob.download_as_bytes()
    except NotFound:
        raise FileNotFoundError(f"Document blob gs://{bucket_name}/{blob_name} does not exist in GCS")


def delete_document_blob(blob_name: str) -> bool:
    """Delete a document object from the configured GCS bucket.

    Args:
        blob_name: The object path to delete.

    Returns:
        True if deleted or already absent.
    """
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise RuntimeError("GCS_BUCKET_NAME is not configured in settings")

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    try:
        blob.delete()
        logger.info("Deleted document from GCS: gs://%s/%s", bucket_name, blob_name)
        return True
    except NotFound:
        logger.warning("Document blob gs://%s/%s already absent from GCS", bucket_name, blob_name)
        return True
    except Exception as exc:
        logger.error("Failed to delete GCS blob gs://%s/%s: %s", bucket_name, blob_name, type(exc).__name__)
        raise


def generate_signed_download_url(
    blob_name: str,
    expiration_minutes: int | None = None,
    original_filename: str | None = None,
) -> str:
    """Generate a short-lived signed GET URL for secure, direct download.

    Args:
        blob_name: Relative object path in the bucket.
        expiration_minutes: Validity duration in minutes.
        original_filename: Suggested filename for Content-Disposition header.

    Returns:
        HTTPS signed URL string.
    """
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise RuntimeError("GCS_BUCKET_NAME is not configured in settings")

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    if not blob.exists():
        raise FileNotFoundError(f"Object {blob_name} does not exist in bucket {bucket_name}")

    mins = expiration_minutes or settings.SIGNED_URL_EXPIRATION_MINUTES
    expiration = datetime.timedelta(minutes=mins)

    response_disposition = None
    if original_filename:
        clean_name = sanitize_filename(original_filename)
        response_disposition = f'attachment; filename="{clean_name}"'

    try:
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=expiration,
            method="GET",
            response_disposition=response_disposition,
        )
        return signed_url
    except Exception as exc:
        logger.error("Signed URL generation failed for %s: %s", blob_name, type(exc).__name__)
        raise RuntimeError(
            f"Signed URL generation is not supported with current credentials: {type(exc).__name__}"
        ) from exc
