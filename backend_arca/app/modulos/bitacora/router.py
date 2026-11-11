from typing import Literal

from fastapi import APIRouter, Query, Response

from app.core.deps import CtxAdmin, DbSession
from app.modulos.bitacora import service
from app.modulos.bitacora.schemas import BitacoraPagina, ResumenBitacora
from app.modulos.bitacora.service import Filtros

# Solo lectura y solo admin: la bitacora no se edita ni se borra (no hay POST/PATCH/PUT/DELETE aqui).
router = APIRouter(prefix="/bitacora", tags=["bitacora"])


def _filtros(
    origen: Literal["acceso", "datos"] | None, evento: str | None, resultado: Literal["ok", "fallo"] | None,
    persona: int | None, desde: str | None, hasta: str | None, ip: str | None,
    entidad: str | None = None,
) -> Filtros:
    return Filtros(
        origen=origen, evento=evento or None, resultado=resultado, persona=persona,
        desde=service.parsear_fecha(desde), hasta=service.parsear_fecha(hasta, fin=True), ip=ip or None, entidad=entidad,
    )


@router.get("", response_model=BitacoraPagina)
def listar(
    db: DbSession, ctx: CtxAdmin,
    origen: Literal["acceso", "datos"] | None = None,
    evento: str | None = Query(default=None, max_length=40, description="Evento de acceso o accion de datos"),
    resultado: Literal["ok", "fallo"] | None = None,
    persona: int | None = None,
    desde: str | None = Query(default=None, description="AAAA-MM-DD o fecha-hora ISO"),
    hasta: str | None = Query(default=None, description="AAAA-MM-DD (dia incluido) o fecha-hora ISO"),
    ip: str | None = Query(default=None, max_length=64),
    entidad: Literal["cuentas"] | None = Query(default=None, description="Filtro de grupo: solo cambios de Cuentas"),
    cursor: str | None = None,
    limite: int = Query(default=30, ge=1, le=100),
):
    """Accesos y cambios de datos mezclados, lo mas reciente primero. Solo admin y solo de su familia."""
    return service.listar(db, ctx, _filtros(origen, evento, resultado, persona, desde, hasta, ip, entidad), cursor, limite)


@router.get("/resumen", response_model=ResumenBitacora)
def resumen(db: DbSession, ctx: CtxAdmin):
    return service.resumen(db, ctx)


@router.get("/exportar.csv")
def exportar(
    db: DbSession, ctx: CtxAdmin,
    origen: Literal["acceso", "datos"] | None = None,
    evento: str | None = Query(default=None, max_length=40),
    resultado: Literal["ok", "fallo"] | None = None,
    persona: int | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    ip: str | None = Query(default=None, max_length=64),
    entidad: Literal["cuentas"] | None = None,
):
    """CSV con los mismos filtros, hasta 5000 filas (la cabecera X-Truncado avisa si habia mas)."""
    texto, truncado = service.exportar_csv(db, ctx, _filtros(origen, evento, resultado, persona, desde, hasta, ip, entidad))
    return Response(
        content="﻿" + texto,  # BOM: Excel reconoce los acentos
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="bitacora.csv"',
            "X-Truncado": "true" if truncado else "false",
            "Cache-Control": "no-store",
        },
    )
