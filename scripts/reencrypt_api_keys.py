"""One-shot migration: re-encrypt base64 API keys with Fernet.

Covers both:
  - model_config.api_key_cipher
  - agent.dify_api_key_cipher

Run from project root:

    # Dry-run (default): prints what would change, no DB writes
    python scripts/reencrypt_api_keys.py

    # Actually commit
    python scripts/reencrypt_api_keys.py --apply
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

# Make `app.*` importable whether run from project root OR from backend/
try:
    import app.core.config  # noqa: F401  -- already on sys.path?
except ImportError:
    BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.admin.models import Agent, ModelConfig  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.security import encrypt_api_key  # noqa: E402
from app.infra.db import SessionLocal  # noqa: E402

FERNET_PREFIX = "gAAAAA"  # Fernet tokens start with this; used to skip already-migrated rows


def _looks_like_fernet(value: str) -> bool:
    return value.startswith(FERNET_PREFIX)


def _try_decode_legacy_base64(value: str) -> str | None:
    """Old payloads were base64-encoded plain text. Return the plain text or None on failure."""
    try:
        return base64.urlsafe_b64decode(value.encode("utf-8")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _migrate_column(db, model_cls, column_attr, label: str, apply: bool) -> tuple[int, int, int]:
    """Return (scanned, converted, skipped)."""
    col = getattr(model_cls, column_attr)
    rows = db.scalars(select(model_cls).where(col.isnot(None))).all()
    scanned = len(rows)
    converted = 0
    skipped = 0

    for row in rows:
        current = getattr(row, column_attr)
        if not current:
            continue
        if _looks_like_fernet(current):
            skipped += 1
            continue
        plain = _try_decode_legacy_base64(current)
        if plain is None:
            print(f"  [{label}] id={row.id} skipped: not base64 decodable ({current[:30]}...)")
            skipped += 1
            continue
        new_cipher = encrypt_api_key(plain)
        marker = f"{current[:18]}... -> {new_cipher[:18]}..."
        print(f"  [{label}] id={row.id} ({getattr(row, 'display_name', None) or getattr(row, 'name', '')}): {marker}")
        if apply:
            setattr(row, column_attr, new_cipher)
            converted += 1

    return scanned, converted, skipped


def main(apply: bool) -> int:
    settings = get_settings()
    if not settings.api_key_encryption_key:
        print("ERROR: API_KEY_ENCRYPTION_KEY is not set in env / .env", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        print(f"=== model_config.api_key_cipher ===")
        mc_scanned, mc_converted, mc_skipped = _migrate_column(
            db, ModelConfig, "api_key_cipher", "model_config", apply
        )
        print(f"  scanned={mc_scanned} converted={mc_converted} skipped={mc_skipped}")

        print(f"=== agent.dify_api_key_cipher ===")
        ag_scanned, ag_converted, ag_skipped = _migrate_column(
            db, Agent, "dify_api_key_cipher", "agent", apply
        )
        print(f"  scanned={ag_scanned} converted={ag_converted} skipped={ag_skipped}")

        total_converted = mc_converted + ag_converted
        if apply:
            db.commit()
            print(f"\nCommitted {total_converted} rows.")
        else:
            db.rollback()
            print(f"\nDRY-RUN — pass --apply to commit {total_converted} rows.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist changes to DB")
    args = parser.parse_args()
    sys.exit(main(apply=args.apply))