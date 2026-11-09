"""Conexion a PostgreSQL y base declarativa."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    """Dependencia de FastAPI: una sesion por peticion."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
