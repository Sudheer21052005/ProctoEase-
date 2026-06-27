"""
Centralised application settings.
All config is read from environment variables (or .env via pydantic-settings).
Phase 10: Added Redis URL, rate limiting toggle, and DB pool settings.
"""

from __future__ import annotations

import json
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="allow",
    )

    # ── Database ──
    DATABASE_URL: str = "postgresql+asyncpg://proctoease:changeme@db:5432/proctoease"

    # ── DB Connection Pool ──
    DB_POOL_SIZE: int = 20          # max persistent connections per worker
    DB_MAX_OVERFLOW: int = 10       # extra connections above pool_size
    DB_POOL_RECYCLE: int = 1800     # recycle connections after 30 min idle
    DB_POOL_TIMEOUT: int = 30       # raise error after 30s if pool exhausted

    # ── JWT ──
    SECRET_KEY: str = "CHANGE-ME"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Redis ──
    REDIS_URL: str = "redis://redis:6379"

    # ── Judge0 ──
    JUDGE0_API_URL: str = "http://judge0-server:2358"

    # ── App ──
    APP_ENV: str = "development"
    DEBUG: bool = True
    CORS_ORIGINS: str = '["http://localhost:3000"]'

    # ── Rate Limiting ──
    RATE_LIMIT_ENABLED: bool = True  # set False in unit tests to skip Redis

    # ── Proctoring image storage ──
    PROCTORING_UPLOAD_ROOT: str = "uploads/proctoring"
    PROCTORING_MAX_IMAGE_BYTES: int = 200 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return json.loads(self.CORS_ORIGINS)


settings = Settings()
