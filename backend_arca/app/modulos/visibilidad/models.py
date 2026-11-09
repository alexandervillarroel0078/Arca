"""Modelos de la privacidad (Fase 17): la columna de visibilidad y la lista de personas elegidas."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

VISIBILIDADES = ("solo_yo", "familia", "elegidas")
# Valores que una PREFERENCIA por defecto puede tomar ("elegidas" necesita una lista, por eso no).
PREFERENCIAS = ("solo_yo", "familia")
CHECK_VISIBILIDAD = "visibilidad in ('solo_yo','familia','elegidas')"


class ConVisibilidad:
    """Mixin de movimientos y apoyos. Las devoluciones NO lo llevan: heredan la visibilidad de su apoyo."""

    visibilidad: Mapped[str] = mapped_column(String(10), default="familia", server_default="familia")


class Compartido(Base):
    """Con quien se comparte un registro cuya visibilidad es 'elegidas'."""

    __tablename__ = "compartidos"
    __table_args__ = (
        UniqueConstraint("entidad", "entidad_id", "usuario_id", name="uq_compartido"),
        Index("ix_compartidos_usuario", "usuario_id", "entidad"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    entidad: Mapped[str] = mapped_column(String(20))  # movimiento | apoyo
    entidad_id: Mapped[int] = mapped_column()
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
