"""Historial de solo agregar: nunca se edita ni se borra (lo garantiza un trigger en PostgreSQL)."""
from datetime import datetime

from sqlalchemy import DDL, DateTime, ForeignKey, Index, String, event, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Historial(Base):
    __tablename__ = "historial"
    __table_args__ = (
        Index("ix_historial_entidad", "familia_id", "entidad", "entidad_id"),
        # Idempotencia (Fase 12): una operacion del cliente deja a lo mas una entrada por registro.
        Index(
            "uq_historial_operacion", "familia_id", "uuid_operacion", "entidad", "entidad_id", "accion",
            unique=True, postgresql_where=text("uuid_operacion is not null"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id"), index=True)
    entidad: Mapped[str] = mapped_column(String(20))  # movimiento|apoyo|devolucion|categoria|miembro|usuario|familia
    entidad_id: Mapped[int] = mapped_column()
    accion: Mapped[str] = mapped_column(String(30))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), index=True)  # quien lo hizo
    fecha: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    cambios: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")  # campo: {antes, despues}
    motivo: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Fase 12: cuando el usuario hizo la accion en su aparato (puede ser mucho antes de `fecha`, que es la de sincronizacion)
    fecha_cliente: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uuid_operacion: Mapped[str | None] = mapped_column(String(36), nullable=True)


# La base impide UPDATE y DELETE sobre el historial (ademas de que la API no tiene rutas para ello).
SQL_FUNCION = """
CREATE OR REPLACE FUNCTION historial_solo_agregar() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'El historial es de solo agregar: no se puede editar ni borrar';
END;
$$ LANGUAGE plpgsql
"""
SQL_TRIGGER = """
CREATE TRIGGER historial_inmutable BEFORE UPDATE OR DELETE ON historial
FOR EACH ROW EXECUTE FUNCTION historial_solo_agregar()
"""
# Tambien se crean al hacer create_all (pruebas); en produccion los crea la migracion 0003.
event.listen(Historial.__table__, "after_create", DDL(SQL_FUNCION).execute_if(dialect="postgresql"))
event.listen(Historial.__table__, "after_create", DDL(SQL_TRIGGER).execute_if(dialect="postgresql"))
