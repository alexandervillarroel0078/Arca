from datetime import date

from fastapi import APIRouter, Response

from app.core.anulable import AnulacionIn, ReactivacionIn
from app.core.deps import Ctx, DbSession
from app.modulos.apoyos import service
from app.modulos.visibilidad.cambios import VisibilidadCambiar
from app.modulos.apoyos.schemas import (
    ApoyoCrear,
    ApoyoEditar,
    ApoyoOut,
    ApoyosResumen,
    DevolucionCrear,
    DevolucionEditar,
)

# Nota: no hay DELETE. Apoyos y devoluciones se anulan y se pueden reactivar.
router = APIRouter(prefix="/apoyos", tags=["apoyos"])


@router.get("", response_model=list[ApoyoOut])
def listar(
    db: DbSession,
    ctx: Ctx,
    beneficiario: str | None = None,
    ver_anulados: bool = False,
    desde: date | None = None,
    hasta: date | None = None,
):
    """Con desde/hasta: los apoyos entregados en ese periodo o con una devolucion hecha en el."""
    return service.listar(db, ctx, beneficiario, ver_anulados, desde, hasta)


@router.post("", response_model=ApoyoOut, status_code=201)
def crear(datos: ApoyoCrear, db: DbSession, ctx: Ctx, response: Response):
    salida, creado = service.crear(db, ctx, datos)
    if not creado:
        response.status_code = 200
    return salida


# /resumen va antes de /{apoyo_id} para que no se confunda con un id
@router.get("/resumen", response_model=ApoyosResumen)
def resumen(db: DbSession, ctx: Ctx, desde: date | None = None, hasta: date | None = None):
    """El pendiente y el estado son ACUMULADOS (no dependen del periodo); desde/hasta solo filtran lo
    entregado y devuelto dentro del periodo (`entregado_periodo`, `devuelto_periodo`)."""
    return service.resumen(db, ctx, desde, hasta)


@router.get("/{apoyo_id}", response_model=ApoyoOut)
def obtener(apoyo_id: int, db: DbSession, ctx: Ctx):
    return service.obtener(db, ctx, apoyo_id)


@router.patch("/{apoyo_id}", response_model=ApoyoOut)
def editar(apoyo_id: int, datos: ApoyoEditar, db: DbSession, ctx: Ctx):
    return service.editar(db, ctx, apoyo_id, datos)


@router.post("/{apoyo_id}/anular", response_model=ApoyoOut)
def anular(apoyo_id: int, datos: AnulacionIn, db: DbSession, ctx: Ctx):
    """Anula tambien las devoluciones activas del apoyo."""
    return service.anular(db, ctx, apoyo_id, datos.motivo, datos.version_base)


@router.post("/{apoyo_id}/reactivar", response_model=ApoyoOut)
def reactivar(apoyo_id: int, db: DbSession, ctx: Ctx, datos: ReactivacionIn | None = None):
    """Reactiva el apoyo y solo las devoluciones que se anularon con el."""
    return service.reactivar(db, ctx, apoyo_id, datos.version_base if datos else None)


@router.post("/{apoyo_id}/devoluciones", response_model=ApoyoOut, status_code=201)
def devolver(apoyo_id: int, datos: DevolucionCrear, db: DbSession, ctx: Ctx, response: Response):
    salida, creada = service.devolver(db, ctx, apoyo_id, datos)
    if not creada:
        response.status_code = 200
    return salida


@router.patch("/{apoyo_id}/devoluciones/{devolucion_id}", response_model=ApoyoOut)
def editar_devolucion(apoyo_id: int, devolucion_id: int, datos: DevolucionEditar, db: DbSession, ctx: Ctx):
    return service.editar_devolucion(db, ctx, apoyo_id, devolucion_id, datos)


@router.post("/{apoyo_id}/devoluciones/{devolucion_id}/anular", response_model=ApoyoOut)
def anular_devolucion(apoyo_id: int, devolucion_id: int, datos: AnulacionIn, db: DbSession, ctx: Ctx):
    return service.anular_devolucion(db, ctx, apoyo_id, devolucion_id, datos.motivo, datos.version_base)


@router.post("/{apoyo_id}/devoluciones/{devolucion_id}/reactivar", response_model=ApoyoOut)
def reactivar_devolucion(
    apoyo_id: int, devolucion_id: int, db: DbSession, ctx: Ctx, datos: ReactivacionIn | None = None
):
    return service.reactivar_devolucion(db, ctx, apoyo_id, devolucion_id, datos.version_base if datos else None)


@router.post("/{apoyo_id}/consumir", response_model=ApoyoOut)
def consumir(apoyo_id: int, db: DbSession, ctx: Ctx):
    return service.consumir(db, ctx, apoyo_id)


@router.post("/{apoyo_id}/reabrir", response_model=ApoyoOut)
def reabrir(apoyo_id: int, db: DbSession, ctx: Ctx):
    """Deshace lo consumido: vuelve a quedar pendiente."""
    return service.reabrir(db, ctx, apoyo_id)


@router.patch("/{apoyo_id}/visibilidad", response_model=ApoyoOut)
def visibilidad(apoyo_id: int, datos: VisibilidadCambiar, db: DbSession, ctx: Ctx):
    """Cambia quien lo ve (solo el dueno). Las devoluciones heredan la visibilidad del apoyo."""
    return service.cambiar_visibilidad(db, ctx, apoyo_id, datos)
