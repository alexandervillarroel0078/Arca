from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.anulable import Anulable
from app.core.db import Base
from app.modulos.visibilidad.models import CHECK_VISIBILIDAD, ConVisibilidad


class Apoyo(ConVisibilidad, Anulable, Base):
    __tablename__ = "apoyos"
    __table_args__ = (CheckConstraint(CHECK_VISIBILIDAD, name="ck_apoyo_visibilidad"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), index=True)  # quien entrega
    beneficiario: Mapped[str] = mapped_column(String(120), index=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    fecha: Mapped[date] = mapped_column(Date, index=True)
    nota: Mapped[str | None] = mapped_column(String(500), nullable=True)
    monto_consumido: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), server_default="0")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Devolucion(Anulable, Base):
    __tablename__ = "devoluciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    apoyo_id: Mapped[int] = mapped_column(ForeignKey("apoyos.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)  # quien la registro
    # True si se anulo automaticamente junto con su apoyo (vuelve al reactivar el apoyo)
    anulada_con_apoyo: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    monto: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    fecha: Mapped[date] = mapped_column(Date)
    nota: Mapped[str | None] = mapped_column(String(500), nullable=True)
