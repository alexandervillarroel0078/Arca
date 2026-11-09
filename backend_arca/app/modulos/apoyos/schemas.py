from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.anulable import AuditoriaOut
from app.modulos.periodos.calculo import hoy_la_paz
from app.core.tipos import Monto, MontoPositivo
from app.modulos.visibilidad.cambios import VisibilidadIn

Estado = Literal["Pendiente", "Saldado", "Cerrado", "Anulado"]


class ApoyoCrear(VisibilidadIn):
    beneficiario: str = Field(min_length=1, max_length=120)
    monto: MontoPositivo
    fecha: date = Field(default_factory=hoy_la_paz)
    nota: str | None = Field(default=None, max_length=500)
    uuid_cliente: UUID | None = None
    # Fase 12: creado y anulado sin internet = una sola operacion
    anulado: bool = False
    motivo_anulacion: str | None = Field(default=None, max_length=300)
    fecha_cliente_anulacion: datetime | None = None


class ApoyoEditar(VisibilidadIn):
    beneficiario: str | None = Field(default=None, min_length=1, max_length=120)
    monto: MontoPositivo | None = None
    fecha: date | None = None
    nota: str | None = Field(default=None, max_length=500)
    version_base: int | None = Field(default=None, ge=1)


class DevolucionCrear(BaseModel):
    monto: MontoPositivo
    fecha: date = Field(default_factory=hoy_la_paz)
    nota: str | None = Field(default=None, max_length=500)
    uuid_cliente: UUID | None = None
    anulado: bool = False
    motivo_anulacion: str | None = Field(default=None, max_length=300)
    fecha_cliente_anulacion: datetime | None = None


class DevolucionEditar(BaseModel):
    monto: MontoPositivo | None = None
    fecha: date | None = None
    nota: str | None = Field(default=None, max_length=500)
    version_base: int | None = Field(default=None, ge=1)


class DevolucionOut(AuditoriaOut):
    id: int
    apoyo_id: int
    monto: Monto
    fecha: date
    nota: str | None
    usuario_id: int | None
    usuario_nombre: str | None
    anulada_con_apoyo: bool


class ApoyoOut(AuditoriaOut):
    id: int
    beneficiario: str
    monto: Monto
    fecha: date
    nota: str | None
    usuario_id: int
    usuario_nombre: str
    visibilidad: str = "familia"
    compartido_con: list[int] = []  # solo lo ve el dueno
    devuelto: Monto  # solo devoluciones activas
    consumido: Monto
    pendiente: Monto
    estado: Estado
    devoluciones: list[DevolucionOut]
    devoluciones_activas: int


class BeneficiarioResumen(BaseModel):
    beneficiario: str
    entregado: Monto
    devuelto: Monto
    consumido: Monto
    pendiente: Monto
    estado: Estado
    cantidad_apoyos: int
    entregado_periodo: Monto  # entregado con fecha dentro del periodo pedido (sin periodo: todo)
    devuelto_periodo: Monto  # devuelto con fecha de devolucion dentro del periodo


class ApoyosResumen(BaseModel):
    total_entregado: Monto
    total_devuelto: Monto
    total_consumido: Monto
    total_pendiente: Monto  # SIEMPRE acumulado: no depende del periodo
    total_entregado_periodo: Monto
    total_devuelto_periodo: Monto
    beneficiarios: list[BeneficiarioResumen]
    incluye_privados: int = 0  # tus apoyos propios que no son de toda la familia y estan incluidos en estos totales
