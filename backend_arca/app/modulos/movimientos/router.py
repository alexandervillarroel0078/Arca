from datetime import date
from typing import Literal

from fastapi import APIRouter, Query, Response

from app.core.anulable import AnulacionIn, ReactivacionIn
from app.core.deps import Ctx, DbSession
from app.modulos.movimientos import service
from app.modulos.movimientos.schemas import MovimientoCrear, MovimientoEditar, MovimientoOut
from app.modulos.visibilidad.cambios import VisibilidadCambiar

# Nota: no hay DELETE. Los movimientos se anulan y se pueden reactivar.
router = APIRouter(prefix="/movimientos", tags=["movimientos"])


@router.get("", response_model=list[MovimientoOut])
def listar(
    db: DbSession,
    ctx: Ctx,
    mes: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    usuario: int | None = None,
    tipo: Literal["gasto", "ingreso"] | None = None,
    categoria: int | None = None,
    ver_anulados: bool = False,
    limite: int = Query(default=200, ge=1, le=500),
    desplazamiento: int = Query(default=0, ge=0),
):
    """Solo lo que tu puedes ver (lo tuyo, lo de la familia y lo compartido contigo). Los anulados se ocultan por defecto."""
    return service.listar(db, ctx, mes, usuario, tipo, categoria, ver_anulados, limite, desplazamiento, desde, hasta)


@router.post("", response_model=MovimientoOut, status_code=201)
def crear(datos: MovimientoCrear, db: DbSession, ctx: Ctx, response: Response):
    salida, creado = service.crear(db, ctx, datos)
    if not creado:
        response.status_code = 200  # el UUID ya existia: se devuelve el registro existente
    return salida


@router.get("/{movimiento_id}", response_model=MovimientoOut)
def obtener(movimiento_id: int, db: DbSession, ctx: Ctx):
    return service.obtener(db, ctx, movimiento_id)


@router.patch("/{movimiento_id}", response_model=MovimientoOut)
def editar(movimiento_id: int, datos: MovimientoEditar, db: DbSession, ctx: Ctx):
    return service.editar(db, ctx, movimiento_id, datos)


@router.post("/{movimiento_id}/anular", response_model=MovimientoOut)
def anular(movimiento_id: int, datos: AnulacionIn, db: DbSession, ctx: Ctx):
    return service.anular(db, ctx, movimiento_id, datos.motivo, datos.version_base)


@router.post("/{movimiento_id}/reactivar", response_model=MovimientoOut)
def reactivar(movimiento_id: int, db: DbSession, ctx: Ctx, datos: ReactivacionIn | None = None):
    return service.reactivar(db, ctx, movimiento_id, datos.version_base if datos else None)


@router.patch("/{movimiento_id}/visibilidad", response_model=MovimientoOut)
def visibilidad(movimiento_id: int, datos: VisibilidadCambiar, db: DbSession, ctx: Ctx):
    """Cambia quien lo ve (solo el dueno). Deja una entrada en el historial que solo ve el dueno."""
    return service.cambiar_visibilidad(db, ctx, movimiento_id, datos)
