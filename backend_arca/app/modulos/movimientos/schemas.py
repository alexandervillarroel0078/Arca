from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.anulable import AuditoriaOut
from app.modulos.periodos.calculo import hoy_la_paz
from app.core.tipos import MontoPositivo
from app.modulos.visibilidad.cambios import VisibilidadIn


class MovimientoCrear(VisibilidadIn):
    tipo: Literal["gasto", "ingreso"]
    monto: MontoPositivo
    fecha: date = Field(default_factory=hoy_la_paz)
    categoria_id: int | None = None  # obligatoria en gasto, vacia en ingreso
    nota: str | None = Field(default=None, max_length=500)
    uuid_cliente: UUID | None = None  # hace idempotente el reenvio desde la cola offline
    # Fase 12: un registro creado Y anulado sin internet sale en una sola operacion (la creacion con el valor final)
    anulado: bool = False
    motivo_anulacion: str | None = Field(default=None, max_length=300)
    fecha_cliente_anulacion: datetime | None = None


class MovimientoEditar(VisibilidadIn):
    tipo: Literal["gasto", "ingreso"] | None = None
    monto: MontoPositivo | None = None
    fecha: date | None = None
    categoria_id: int | None = None
    nota: str | None = Field(default=None, max_length=500)
    version_base: int | None = Field(default=None, ge=1)  # version en la que se baso el cliente (409 si ya cambio)


class MovimientoOut(AuditoriaOut):
    id: int
    tipo: str
    monto: MontoPositivo
    fecha: date
    categoria_id: int | None
    categoria_nombre: str | None
    categoria_icono: str | None
    nota: str | None
    usuario_id: int
    usuario_nombre: str
    visibilidad: str = "familia"
    compartido_con: list[int] = []  # solo lo ve el dueno (a los demas siempre vacio)
