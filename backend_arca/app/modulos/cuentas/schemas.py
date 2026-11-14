"""Esquemas de Cuentas. Los montos ENTRAN como numero o texto y SALEN siempre como texto (sin perder decimales)."""
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.anulable import AuditoriaOut
from app.modulos.cuentas.monedas import AVISO_NOTA
from app.modulos.periodos.calculo import hoy_la_paz
from app.modulos.visibilidad.cambios import VisibilidadIn

Tipo = Literal["ahorro", "corriente", "cripto", "efectivo"]
Moneda = Literal["BS", "USD", "USDT", "BTC"]
PersonaTipo = Literal["miembro", "otra", "sin_identificar"]
# Entrada de dinero: se valida segun la moneda de la cuenta (decimales) en el servicio.
Dinero = Decimal

AYUDA_NOTA = {"ayuda": AVISO_NOTA}


def nota_campo():
    return Field(default=None, max_length=500, description=AVISO_NOTA, json_schema_extra=AYUDA_NOTA)


# ------------------------------------------------------------------ cuentas
class CuentaCrear(VisibilidadIn):
    nombre: str = Field(min_length=1, max_length=80)
    tipo: Tipo
    moneda: Moneda
    banco: str | None = Field(default=None, max_length=60, description="Banco o plataforma de la lista (o «Otro»)")
    banco_otro: str | None = Field(default=None, max_length=60)
    ultimos4: str | None = Field(
        default=None, pattern=r"^[0-9]{4}$",
        description="SOLO los últimos 4 dígitos. Nunca el número completo, claves ni frases semilla.",
        json_schema_extra={"ayuda": "Solo los últimos 4 dígitos: nunca el número completo."},
    )
    saldo_inicial: Dinero = Field(default=Decimal(0), allow_inf_nan=False)
    encargado_id: int | None = None
    uuid_cliente: UUID | None = None


class CuentaEditar(VisibilidadIn):
    """Solo el dueño. `tipo`, `moneda` y `saldo_inicial` solo cambian mientras la cuenta no tenga movimientos."""

    nombre: str | None = Field(default=None, min_length=1, max_length=80)
    tipo: Tipo | None = None
    moneda: Moneda | None = None
    banco: str | None = Field(default=None, max_length=60)
    banco_otro: str | None = Field(default=None, max_length=60)
    ultimos4: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    saldo_inicial: Dinero | None = Field(default=None, allow_inf_nan=False)
    encargado_id: int | None = None  # null explicito = quitar al encargado
    version_base: int | None = Field(default=None, ge=1)


class TotalMoneda(BaseModel):
    moneda: str
    total: str
    cuentas: int
    hay_negativas: bool = False


class CuentaOut(AuditoriaOut):
    id: int
    nombre: str
    tipo: str
    banco: str | None
    banco_otro: str | None
    moneda: str
    ultimos4: str | None
    saldo_inicial: str
    saldo: str  # calculado: saldo_inicial + movimientos activos (nunca guardado)
    saldo_negativo: bool  # aviso, no bloquea
    visibilidad: str
    compartido_con: list[int] = []  # solo lo ve el dueno
    usuario_id: int
    usuario_nombre: str
    encargado_id: int | None
    encargado_nombre: str | None
    es_dueno: bool
    puede_registrar: bool  # dueno o encargado


class CuentasOut(BaseModel):
    cuentas: list[CuentaOut]
    totales: list[TotalMoneda]  # por moneda, sin conversion; solo cuentas visibles y no anuladas
    privadas_propias: int  # "incluye tus N cuentas privadas"


# ------------------------------------------------------------------ movimientos
class PersonaIn(BaseModel):
    persona_tipo: PersonaTipo = "sin_identificar"
    persona_usuario_id: int | None = None  # miembro de la familia
    persona_nombre: str | None = Field(default=None, max_length=80)  # "otra persona" (nombre libre, sin crear usuario)


class MovimientoBase(PersonaIn):
    monto: Dinero = Field(allow_inf_nan=False)
    fecha: date = Field(default_factory=hoy_la_paz)
    nota: str | None = nota_campo()
    uuid_cliente: UUID | None = None


class DepositoCrear(MovimientoBase):
    tipo: Literal["deposito"] = "deposito"


class RetiroCrear(MovimientoBase):
    tipo: Literal["retiro"] = "retiro"
    comision: Dinero | None = Field(
        default=None, allow_inf_nan=False, description="Comisión de red (solo cuentas cripto): se descuenta ADEMÁS del monto"
    )


class AjusteCrear(PersonaIn):
    """Ajuste por conteo: indicas el saldo REAL y el sistema registra la diferencia."""

    tipo: Literal["ajuste"] = "ajuste"
    saldo_declarado: Dinero = Field(allow_inf_nan=False)
    fecha: date = Field(default_factory=hoy_la_paz)
    nota: str | None = nota_campo()
    uuid_cliente: UUID | None = None


class TraspasoCrear(MovimientoBase):
    tipo: Literal["traspaso"] = "traspaso"
    cuenta_id: int  # origen
    cuenta_destino_id: int


class MovimientoFechaEditar(BaseModel):
    """Lo UNICO que se corrige de un movimiento: su fecha (nunca en un ajuste por conteo). Ni hoy en La Paz se pasa."""

    fecha: date
    version_base: int | None = Field(default=None, ge=1)


class MovimientoCuentaOut(AuditoriaOut):
    id: int
    tipo: str
    moneda: str
    monto: str
    comision: str | None
    sentido: str | None
    saldo_previo: str | None
    saldo_declarado: str | None
    fecha: date
    nota: str | None
    cuenta_id: int | None  # nulo si es una cuenta que el lector no ve
    cuenta_nombre: str  # "otra cuenta" si no la ve
    cuenta_destino_id: int | None
    cuenta_destino_nombre: str | None
    persona_tipo: str
    persona_usuario_id: int | None
    persona_nombre: str | None
    usuario_id: int
    usuario_nombre: str
    puede_registrar: bool  # dueno o encargado de TODAS las cuentas que toca (puede anularlo/reactivarlo)
    efecto: str | None = None  # solo en la lista de una cuenta: lo que suma (+) o resta (-) a ESA cuenta
    saldo_resultante: str | None = None  # solo al crear o reactivar: saldo de la cuenta de origen despues
    deja_saldo_negativo: bool | None = None  # solo al crear o reactivar: aviso, no bloquea


class Catalogo(BaseModel):
    monedas: dict[str, int]  # moneda -> decimales
    monedas_por_tipo: dict[str, list[str]]
    bancos: list[str]
    plataformas: list[str]
    aviso_nota: str
