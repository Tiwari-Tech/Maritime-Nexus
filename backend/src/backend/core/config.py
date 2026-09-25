import io
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import dotenv_values
from pydantic import SecretStr, field_validator
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

# Backend project root directory: Z:\Somesh\Maritime Nexus\backend
_core_dir = Path(__file__).resolve().parent
_backend_pkg_dir = _core_dir.parent
_src_dir = _backend_pkg_dir.parent
BACKEND_DIR = _src_dir.parent

ENV_FILE_PATH = BACKEND_DIR / ".env"


class RobustDotEnvSettingsSource(DotEnvSettingsSource):
    """DotEnv settings source that:
    1. Parses only active 'KEY=VALUE' assignment lines.
    2. Ignores bare variable names, checklist items, or lines without '=' assignments.
    3. Prevents empty or None entries from overwriting valid non-empty credentials.
    """

    def _read_env_files(self) -> Mapping[str, str | None]:
        env_files = self.env_file
        if env_files is None:
            return {}
        if isinstance(env_files, (str, Path)):
            env_files = [env_files]

        dotenv_vars: dict[str, str | None] = {}
        for env_file in env_files:
            env_path = Path(env_file).expanduser()
            if not env_path.is_file():
                continue
            with open(
                env_path,
                "r",
                encoding=self.env_file_encoding or "utf-8",
                errors="replace",
            ) as f:
                for line in f:
                    stripped = line.strip()
                    # Skip empty lines and comment lines
                    if not stripped or stripped.startswith("#") or stripped.startswith("//"):
                        continue
                    # Only process lines with an assignment '='
                    if "=" in stripped:
                        parsed = dotenv_values(
                            stream=io.StringIO(line),
                            encoding=self.env_file_encoding or "utf-8",
                        )
                        for k, v in parsed.items():
                            if v is not None and v != "":
                                dotenv_vars[k] = v
                            elif k not in dotenv_vars:
                                dotenv_vars[k] = v
        return dotenv_vars


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE_PATH,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "Maritime Nexus API"
    VERSION: str = "0.1.0"
    DESCRIPTION: str = "AI Maritime Operations & Contract Intelligence Copilot API"
    ENVIRONMENT: str = "development"

    # CORS Configuration
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            origins = [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, tuple)):
            origins = [str(i).strip() for i in v if str(i).strip()]
        else:
            return v
        return [o.rstrip("/") for o in origins]

    # Database Configuration (Cloud SQL PostgreSQL)
    DATABASE_NAME: str = "maritime_nexus"
    DB_USER: str = "postgres"
    DB_PASSWORD: SecretStr = SecretStr("")
    CLOUD_SQL_CONNECTION_NAME: str = "maritime-nexus:asia-south1:maritime-nexus-db"

    # Host and port for TCP connections (defaults to Cloud SQL Auth Proxy on 127.0.0.1:5432)
    DB_HOST: str | None = None
    DB_PORT: int | None = None
    DB_CONNECT_TIMEOUT: int = 10

    # Connection pool configuration
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE: int = 1800
    DB_ECHO: bool = False

    # Optional direct database URL override
    DATABASE_URL: str | None = None

    # Ollama & Embedding Configuration (BGE-M3 default dimension is 1024)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    EMBEDDING_MODEL: str = "bge-m3"
    EMBEDDING_DIMENSION: int = 1024
    QWEN_MODEL: str = "gemma3:1b"
    OLLAMA_LLM_TIMEOUT_SECONDS: int = 120
    OLLAMA_NUM_PREDICT: int = 512

    # RAG Chunking & Retrieval Configuration
    RAG_CHUNK_SIZE: int = 1000
    RAG_CHUNK_OVERLAP: int = 200
    RAG_DEFAULT_TOP_K: int = 5
    RAG_MAX_TOP_K: int = 20

    # Firebase Configuration
    FIREBASE_PROJECT_ID: str = "maritime-nexus"
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None

    # Google Cloud Storage Configuration
    GCS_BUCKET_NAME: str = ""
    MAX_DOCUMENT_SIZE_MB: int = 50
    SIGNED_URL_EXPIRATION_MINUTES: int = 15

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            RobustDotEnvSettingsSource(settings_cls),
            file_secret_settings,
        )

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        """Construct the PostgreSQL SQLAlchemy connection URI."""
        if self.DATABASE_URL:
            url = self.DATABASE_URL
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+psycopg://", 1)
            return url

        pwd = quote_plus(self.DB_PASSWORD.get_secret_value())
        user = quote_plus(self.DB_USER)
        db = self.DATABASE_NAME

        # Cloud Run / Unix socket connection
        socket_dir = Path(f"/cloudsql/{self.CLOUD_SQL_CONNECTION_NAME}")
        if socket_dir.exists():
            return f"postgresql+psycopg://{user}:{pwd}@/{db}?host={socket_dir}"

        # Local development / TCP connection (e.g. Cloud SQL Auth Proxy or direct host)
        host = self.DB_HOST or "127.0.0.1"
        port = self.DB_PORT or 5432
        return f"postgresql+psycopg://{user}:{pwd}@{host}:{port}/{db}"


settings = Settings()
