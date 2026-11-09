from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.anulable import Anulable
from app.core.db import Base
from app.modulos.visibilidad.models import CHECK_VISIBILIDAD, ConVisibilidad


class Movimiento(ConVisibilidad, Anulable, Base):
    __tablename__ = "movimientos"
    __table_args__ = (
        CheckConstraint("tipo in ('gasto','ingreso')", name="ck_movimiento_tipo"),
        CheckConstraint(CHECK_VISIBILIDAD, name="ck_movimiento_visibilidad"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(10))  # gasto | ingreso
    monto: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    fecha: Mapped[date] = mapped_column(Date, index=True)
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categorias.id"), nullable=True)
    nota: Mapped[str | None] = mapped_column(String(500), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
