from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.core.deps import Ctx, DbSession
from app.modulos.historial import service
from app.modulos.historial.schemas import HistorialPagina
from app.modulos.visibilidad import service as vis

# Solo lectura: el historial no se edita ni se borra (no hay POST/PATCH/PUT/DELETE aqui).
router = APIRouter(prefix="/historial", tags=["historial"])

Entidad = Literal[
    "movimiento", "apoyo", "devolucion", "categoria", "miembro", "usuario", "familia", "cuenta", "cuenta_mov", "cuentas"
]  # "cuentas" = filtro de grupo (cuenta + cuenta_mov), solo para listas


@router.get("", response_model=HistorialPagina)
def listar(
    db: DbSession,
    ctx: Ctx,
    entidad: Entidad | None = None,
    entidad_id: int | None = None,
    accion: str | None = None,
    usuario: int | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=30, ge=1, le=100),
    desplazamiento: int = Query(default=0, ge=0),
):
    """Con `entidad` y `entidad_id`: cadena de un registro (cualquier miembro, en orden cronologico).
    Sin `entidad_id`: actividad global de la familia (solo admin, mas reciente primero)."""
    if entidad_id is not None and entidad is None:
        raise HTTPException(status_code=422, detail="Indica también la entidad")
    if entidad == "cuentas" and entidad_id is not None:
        raise HTTPException(status_code=422, detail="«cuentas» es un filtro de grupo: usa «cuenta» o «cuenta_mov» con un id")
    cadena = entidad is not None and entidad_id is not None
    if not cadena and not ctx.es_admin:
        raise HTTPException(status_code=403, detail="Solo un administrador puede ver la actividad de la familia")
    if cadena:
        vis.exigir_ver_entidad(db, ctx, entidad, entidad_id)  # lo que no ves responde 404, como si no existiera
    return service.listar(
        db, ctx, entidad, entidad_id, accion, usuario, desde, hasta, limite, desplazamiento, cronologico=cadena
    )
