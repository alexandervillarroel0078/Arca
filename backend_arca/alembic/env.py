"""Entorno de Alembic: usa DATABASE_URL de la configuracion de la app."""
from alembic import context
from sqlalchemy import create_engine

from app.core.config import settings
from app.core.db import Base
import app.modulos.registry  # noqa: F401

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
