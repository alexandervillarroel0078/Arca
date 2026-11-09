from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import Ctx, DbSession
from app.modulos.actividad import service
from app.modulos.actividad.schemas import ActividadPagina

router = APIRouter(prefix="/actividad", tags=["actividad"])


@router.get("", response_model=ActividadPagina)
def listar(
    db: DbSession,
    ctx: Ctx,
    mes: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    usuario: int | None = None,
    tipo: Literal["gasto", "ingreso", "apoyo"] | None = None,
    categoria: int | None = None,
    ver_anulados: bool = False,
    limite: int = Query(default=30, ge=1, le=100),
    desplazamiento: int = Query(default=0, ge=0),
):
    """Lista completa de movimientos y apoyos (lo anulado se oculta salvo ver_anulados)."""
    return service.listar(db, ctx, mes, usuario, tipo, categoria, ver_anulados, limite, desplazamiento, desde, hasta)
