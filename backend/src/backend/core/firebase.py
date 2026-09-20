"""Firebase Admin SDK initialization module.

Ensures singleton initialization of Firebase Admin using Application Default
Credentials (locally via GOOGLE_APPLICATION_CREDENTIALS, or managed IAM on Cloud Run).
"""

import logging
import os

import firebase_admin
from firebase_admin import credentials

from backend.core.config import settings

logger = logging.getLogger(__name__)


def get_firebase_app() -> firebase_admin.App:
    """Initialize and return the default Firebase Admin App singleton.

    Safely reuses existing default app if already initialized.
    """
    try:
        return firebase_admin.get_app()
    except ValueError:
        # App is not yet initialized
        pass

    # Ensure GOOGLE_APPLICATION_CREDENTIALS is in os.environ for Google Cloud SDKs
    if settings.GOOGLE_APPLICATION_CREDENTIALS and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
    else:
        # Use Google Cloud Application Default Credentials (ideal for Cloud Run / GCP environments)
        cred = credentials.ApplicationDefault()

    options: dict[str, str] = {}
    if settings.FIREBASE_PROJECT_ID:
        options["projectId"] = settings.FIREBASE_PROJECT_ID

    app = firebase_admin.initialize_app(cred, options=options)
    logger.info("Initialized Firebase Admin SDK for project: %s", settings.FIREBASE_PROJECT_ID)
    return app
