#!/bin/sh
set -e

STAMP_REVISION="$(python - <<'PY'
from sqlalchemy import create_engine, inspect

from app.core.config import get_settings

engine = create_engine(get_settings().database_url)
tables = set(inspect(engine).get_table_names())

if "alembic_version" in tables or not tables:
    print("")
elif "student_agent_attachment" in tables:
    print("20260605_0006")
elif {"student_agent_session", "student_agent_message", "student_agent_activity"}.issubset(tables):
    print("20260605_0005")
elif {"master_agent_config", "master_route_rule"}.issubset(tables):
    print("20260605_0007")
elif "system_config" in tables:
    print("20260604_0003")
elif "model_config" in tables:
    print("20260604_0002")
elif {"admin_user", "student_user"}.issubset(tables):
    print("20260603_0001")
else:
    print("")
PY
)"

if [ -n "$STAMP_REVISION" ]; then
  echo "Existing database without alembic_version; stamping $STAMP_REVISION..."
  alembic stamp "$STAMP_REVISION"
fi

echo "Running database migrations..."
# Use `upgrade heads` (plural) so that branching migration histories (multiple
# heads) still reach every branch's tip. After merges are introduced the
# preferred single-head form `upgrade head` will resume working.
set +e
alembic upgrade heads
alembic_rc=$?
set -e
if [ $alembic_rc -ne 0 ]; then
  echo "alembic upgrade heads failed (rc=$alembic_rc); falling back to stamp heads" >&2
  alembic stamp heads || alembic upgrade head
fi

# High-concurrency: multiple workers with tuned timeouts
# WEB_CONCURRENCY env overrides worker count; defaults to 4
WORKERS=${WEB_CONCURRENCY:-4}
echo "Starting server with $WORKERS workers..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS" --limit-concurrency 1000 --backlog 2048 --timeout-keep-alive 30
