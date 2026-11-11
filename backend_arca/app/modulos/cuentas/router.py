from datetime import date
from typing import Literal

from fastapi import APIRouter, Query, Response

from app.core.anulable import AnulacionIn, ReactivacionIn
from app.core.deps import Ctx, DbSession
from app.modulos.cuentas import service
from app.modulos.cuentas.schemas import (
    AjusteCrear, Catalogo, CuentaCrear, CuentaEditar, CuentaOut, CuentasOut, DepositoCrear, MovimientoCuentaOut,
    RetiroCrear, TraspasoCrear,
)
from app.modulos.visibilidad.cambios import VisibilidadCambiar

# Nota: no hay DELETE. Cuentas y movimientos se anulan y se pueden reactivar. Las rutas fijas van ANTES de /{cuenta_id}.
router = APIRouter(prefix="/cuentas", tags=["cuentas"])


@router.get("", response_model=CuentasOut)
def listar(db: DbSession, ctx: Ctx, ver_anuladas: bool = False):
    """Solo las cuentas que ves, con totales por moneda (sin conversion; sin cuentas anuladas)."""
    return service.listar(db, ctx, ver_anuladas)


@router.post("", response_model=CuentaOut, status_code=201)
def crear(datos: CuentaCrear, db: DbSession, ctx: Ctx, response: Response):
    salida, creado = service.crear(db, ctx, datos)
    if not creado:
        response.status_code = 200
    return salida


@router.get("/catalogo", response_model=Catalogo)
def catalogo(ctx: Ctx):
    """Monedas con sus decimales, tipos, bancos, plataformas y el aviso de las notas (para armar el formulario)."""
    return service.catalogo()


@router.get("/movimientos", response_model=list[MovimientoCuentaOut])
def listar_movimientos(
    db: DbSession,
    ctx: Ctx,
    tipo: Literal["deposito", "retiro", "traspaso", "ajuste"] | None = None,
    ver_anulados: bool = False,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=100, ge=1, le=500),
    desplazamiento: int = Query(default=0, ge=0),
):
    return service.listar_movimientos(db, ctx, None, tipo, ver_anulados, limite, desplazamiento, desde, hasta)


@router.post("/traspasos", response_model=MovimientoCuentaOut, status_code=201)
def traspaso(datos: TraspasoCrear, db: DbSession, ctx: Ctx, response: Response):
    """Mueve el MISMO monto entre dos cuentas de la misma moneda. Exige ser dueño o encargado de AMBAS."""
    salida, creado = service.registrar_traspaso(db, ctx, datos)
    if not creado:
        response.status_code = 200
    return salida


@router.get("/movimientos/{movimiento_id}", response_model=MovimientoCuentaOut)
def obtener_movimiento(movimiento_id: int, db: DbSession, ctx: Ctx):
    return service.obtener_movimiento(db, ctx, movimiento_id)


@router.post("/movimientos/{movimiento_id}/anular", response_model=MovimientoCuentaOut)
def anular_movimiento(movimiento_id: int, datos: AnulacionIn, db: DbSession, ctx: Ctx):
    return service.anular_movimiento(db, ctx, movimiento_id, datos.motivo, datos.version_base)


@router.post("/movimientos/{movimiento_id}/reactivar", response_model=MovimientoCuentaOut)
def reactivar_movimiento(movimiento_id: int, db: DbSession, ctx: Ctx, datos: ReactivacionIn | None = None):
    return service.reactivar_movimiento(db, ctx, movimiento_id, datos.version_base if datos else None)


@router.get("/{cuenta_id}", response_model=CuentaOut)
def obtener(cuenta_id: int, db: DbSession, ctx: Ctx):
    return service.obtener(db, ctx, cuenta_id)


@router.patch("/{cuenta_id}", response_model=CuentaOut)
def editar(cuenta_id: int, datos: CuentaEditar, db: DbSession, ctx: Ctx):
    return service.editar(db, ctx, cuenta_id, datos)


@router.post("/{cuenta_id}/anular", response_model=CuentaOut)
def anular(cuenta_id: int, datos: AnulacionIn, db: DbSession, ctx: Ctx):
    return service.anular(db, ctx, cuenta_id, datos.motivo, datos.version_base)


@router.post("/{cuenta_id}/reactivar", response_model=CuentaOut)
def reactivar(cuenta_id: int, db: DbSession, ctx: Ctx, datos: ReactivacionIn | None = None):
    return service.reactivar(db, ctx, cuenta_id, datos.version_base if datos else None)


@router.patch("/{cuenta_id}/visibilidad", response_model=CuentaOut)
def visibilidad(cuenta_id: int, datos: VisibilidadCambiar, db: DbSession, ctx: Ctx):
    """Cambia quién la ve (solo el dueño). Los movimientos heredan la visibilidad de su cuenta."""
    return service.cambiar_visibilidad(db, ctx, cuenta_id, datos)


@router.get("/{cuenta_id}/movimientos", response_model=list[MovimientoCuentaOut])
def movimientos_de(
    cuenta_id: int,
    db: DbSession,
    ctx: Ctx,
    tipo: Literal["deposito", "retiro", "traspaso", "ajuste"] | None = None,
    ver_anulados: bool = False,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=100, ge=1, le=500),
    desplazamiento: int = Query(default=0, ge=0),
):
    return service.listar_movimientos(db, ctx, cuenta_id, tipo, ver_anulados, limite, desplazamiento, desde, hasta)


@router.post("/{cuenta_id}/depositos", response_model=MovimientoCuentaOut, status_code=201)
def deposito(cuenta_id: int, datos: DepositoCrear, db: DbSession, ctx: Ctx, response: Response):
    salida, creado = service.registrar_deposito(db, ctx, cuenta_id, datos)
    if not creado:
        response.status_code = 200
    return salida


@router.post("/{cuenta_id}/retiros", response_model=MovimientoCuentaOut, status_code=201)
def retiro(cuenta_id: int, datos: RetiroCrear, db: DbSession, ctx: Ctx, response: Response):
    """Retiro. En cuentas cripto admite `comision` de red, que se descuenta además del monto."""
    salida, creado = service.registrar_retiro(db, ctx, cuenta_id, datos)
    if not creado:
        response.status_code = 200
    return salida


@router.post("/{cuenta_id}/ajustes", response_model=MovimientoCuentaOut, status_code=201)
def ajuste(cuenta_id: int, datos: AjusteCrear, db: DbSession, ctx: Ctx, response: Response):
    """Ajuste por conteo: indicas el saldo real y el sistema registra la diferencia."""
    salida, creado = service.registrar_ajuste(db, ctx, cuenta_id, datos)
    if not creado:
        response.status_code = 200
    return salida
