# Maritime Nexus — Authentication & Authorization Architecture

## 1. Overview & Flow

Maritime Nexus integrates **Firebase Authentication** for identity management and **PostgreSQL** for multi-tenant data ownership and Role-Based Access Control (RBAC).

```
Frontend (Next.js)
  │ (User logs in via Email/Password or Google)
  ▼
Firebase Authentication
  │ (Issues cryptographically signed JWT ID Token)
  ▼
API Request to FastAPI Backend
  │ Header: "Authorization: Bearer <Firebase_ID_Token>"
  ▼
FastAPI Dependency (get_current_firebase_user)
  │ Verifies signature, expiry, and project ID using Firebase Admin SDK
  ▼
Local User Synchronization (sync_firebase_user)
  │ Resolves or provisions local database `User` record
  ▼
Authorization Checks (Role & Organization)
  │ Enforces role hierarchy and organization scoping via PostgreSQL
  ▼
Route Handler Execution
```

---

## 2. Token Verification & Transport

- **Header Specification**: Clients send the Firebase ID token in standard HTTP Authorization headers:
  `Authorization: Bearer <firebase_id_token>`
- **Verification (`backend.core.security.get_current_firebase_user`)**:
  - Rejects missing or malformed headers with `401 Unauthorized` and `WWW-Authenticate: Bearer`.
  - Verifies signature, expiration, and project validity using `firebase_admin.auth.verify_id_token(token, check_revoked=True)`.
  - Returns a sanitized `FirebaseUser` object (`uid`, `email`, `display_name`).
  - **Security Rule**: The raw token is never returned to clients, stored in user models, or printed in logs.

---

## 3. Firebase Identity Mapping to Local Database

- **Source of Identity**: Firebase manages authentication (who the user is).
- **Source of Authority**: PostgreSQL manages authorization (what organization they belong to and what permissions they hold).
- **Synchronization Logic (`backend.services.user_sync.get_or_create_user`)**:
  - Look up local user by `firebase_uid`.
  - **Existing User**: Updates profile information (`email`, `full_name`) if changed. **Never** alters `role`, `organization_id`, or `is_active` based on client or token claims.
  - **New User**: Creates a local record with:
    - `role`: `viewer` (least-privileged default).
    - `organization_id`: `None` (access blocked until explicitly assigned by an administrator).
    - `is_active`: `True`.
  - Handles concurrent creation race conditions gracefully via database transaction rollback and re-fetching.

---

## 4. Multi-Tenant Organization Authorization

- Authenticated users access multi-tenant resources through `get_current_org` (`backend.api.dependencies`).
- Requires that `user.organization_id` is set and points to an active `Organization` in PostgreSQL.
- If the user has not been assigned to an organization, the dependency raises `403 Forbidden: Organization access required`.
- **Security Rule**: Organization IDs passed in client headers or request parameters are never trusted as authorization boundaries. Tenant context is always derived server-side from the authenticated user's database record.

---

## 5. Role-Based Access Control (RBAC)

Supported roles:
1. `admin`: Full administrative control across the organization.
2. `manager`: Voyage and contract operational management.
3. `operator`: Daily operational logging and document uploads.
4. `analyst`: Read-only access to voyage timelines and analytics.
5. `viewer`: Minimal default access.

**Usage on endpoints**:
```python
from fastapi import APIRouter, Depends
from backend.api.dependencies import require_roles, require_admin
from backend.models.organization import User

router = APIRouter()

@router.post("/vessels")
def create_vessel(user: User = Depends(require_admin)):
    ...

@router.get("/reports")
def view_reports(user: User = Depends(require_roles("admin", "manager", "analyst"))):
    ...
```

---

## 6. Frontend Trust Boundary Rules

Never trust the frontend for:
- User roles or admin flags.
- Organization assignment (`organization_id`).
- Subscription or billing status.
- File ownership claims.

All authorization decisions evaluate against PostgreSQL records fetched during request execution.

---

## 7. Environment & Credential Management

- **Local Development**:
  - Uses `GOOGLE_APPLICATION_CREDENTIALS` configured in `.env` pointing to a local service account JSON file.
  - Initialized once via `backend.core.firebase.get_firebase_app()` without hardcoding paths into version control.
- **Production (Google Cloud Run)**:
  - Connects using Cloud Run's attached IAM Service Account (`credentials.ApplicationDefault()`).
  - No credentials file path is required on Cloud Run.
