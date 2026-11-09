from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Familia(Base):
    __tablename__ = "familias"
    __table_args__ = (CheckConstraint("dia_inicio_mes BETWEEN 1 AND 28", name="ck_familias_dia_inicio_mes"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    # dia en que empieza el "mes" de los periodos (1 = mes calendario). Solo cambia la VISTA, nunca los datos.
    dia_inicio_mes: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Miembro(Base):
    __tablename__ = "miembros"
    __table_args__ = (
        UniqueConstraint("usuario_id", "familia_id", name="uq_miembro_usuario_familia"),
        CheckConstraint("visibilidad_defecto in ('solo_yo','familia')", name="ck_miembro_visibilidad_defecto"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id", ondelete="CASCADE"), index=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    rol: Mapped[str] = mapped_column(String(10))  # admin | miembro
    activo: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Fase 17: visibilidad que heredan los registros nuevos de este miembro (solo_yo | familia)
    visibilidad_defecto: Mapped[str] = mapped_column(String(10), default="familia", server_default="familia")
