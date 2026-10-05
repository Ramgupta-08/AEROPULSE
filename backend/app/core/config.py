"""Runtime configuration. Everything is local-first: no network is needed after setup."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
DATA_DIR = REPO_ROOT / "data"
CMAPSS_DIR = DATA_DIR / "cmapss"
ARTIFACTS_DIR = BACKEND_ROOT / "app" / "ml" / "artifacts"
MANUALS_DIR = BACKEND_ROOT / "app" / "seed" / "manuals"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv("AEROPULSE_DB_URL", f"sqlite:///{DATA_DIR / 'aeropulse.db'}")
    )
    anthropic_api_key: str | None = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY") or None)
    anthropic_model: str = field(default_factory=lambda: os.getenv("AEROPULSE_LLM_MODEL", "claude-opus-5-5"))
    telemetry_hz: float = 2.0
    seed: int = 2026


settings = Settings()
