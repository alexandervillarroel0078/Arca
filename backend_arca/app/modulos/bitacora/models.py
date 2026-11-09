"""Bitacora de accesos y seguridad: de solo agregar (lo garantiza un trigger de PostgreSQL, igual que `historial`).

Los cambios de DATOS no se copian aqui: viven en `historial` y la pantalla los mezcla al leer.
NUNCA se guardan claves, hashes, JWT, cuerpos de peticiones ni claves temporales.
"""
from datetime import datetime

from sqlalchemy import DDL, DateTime, ForeignKey, Index, String, event, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Bitacora(Base):
    __tablename__ = "bitacora"
    __table_args__ = (
        Index("ix_bitacora_familia_fecha", "familia_id", "fecha", "id"),
        Index("ix_bitacora_correo", "correo_intentado"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int | None] = mapped_column(ForeignKey("familias.id"), nullable=True)  # nulo: sin identificacion
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)  # nulo: no existe
    correo_intentado: Mapped[str | None] = mapped_column(String(254), nullable=True)  # solo eventos de login, en minusculas
    evento: Mapped[str] = mapped_column(String(40))
    resultado: Mapped[str] = mapped_column(String(5))  # ok | fallo
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dispositivo: Mapped[str | None] = mapped_column(String(200), nullable=True)  # user-agent recortado
    fecha: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # servidor, UTC
    detalle: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")


SQL_FUNCION = """
CREATE OR REPLACE FUNCTION bitacora_solo_agregar() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La bitacora es de solo agregar: no se puede editar ni borrar';
END;
$$ LANGUAGE plpgsql
"""
SQL_TRIGGER = """
CREATE TRIGGER bitacora_inmutable BEFORE UPDATE OR DELETE ON bitacora
FOR EACH ROW EXECUTE FUNCTION bitacora_solo_agregar()
"""
# Tambien se crean al hacer create_all (pruebas); en produccion los crea la migracion 0005.
event.listen(Bitacora.__table__, "after_create", DDL(SQL_FUNCION).execute_if(dialect="postgresql"))
event.listen(Bitacora.__table__, "after_create", DDL(SQL_TRIGGER).execute_if(dialect="postgresql"))
