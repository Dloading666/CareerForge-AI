from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()

_engine = None


def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    settings = get_settings()
    engine_kwargs = {}
    if settings.database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # High-concurrency MySQL connection pool tuning
        engine_kwargs.update({
            "pool_size": 20,
            "max_overflow": 40,
            "pool_pre_ping": True,
            "pool_recycle": 3600,
            "pool_timeout": 30,
            "echo_pool": False,
        })
    _engine = create_engine(settings.database_url, future=True, **engine_kwargs)
    return _engine


engine = get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine(), future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
