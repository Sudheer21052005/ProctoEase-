"""
Structured logging configuration using Python's built-in logging.

- Development: human-readable console output
- Production: structured format with request correlation fields
"""

from __future__ import annotations

import logging
import sys

from app.core.config import settings


def setup_logging() -> None:
    """Configure application logging."""
    level = logging.DEBUG if settings.DEBUG else logging.INFO

    # Format depends on environment
    if settings.APP_ENV == "production":
        fmt = (
            '{"timestamp":"%(asctime)s","level":"%(levelname)s",'
            '"logger":"%(name)s","message":"%(message)s"}'
        )
    else:
        fmt = "%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s"

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S"))

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    # Quiet noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    logger = logging.getLogger("proctoease")
    logger.info("Logging configured — env=%s level=%s", settings.APP_ENV, logging.getLevelName(level))
