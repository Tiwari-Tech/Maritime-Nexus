"""Maritime Nexus Backend Package."""


def main() -> None:
    """Entry point for running the application via uv run backend."""
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
