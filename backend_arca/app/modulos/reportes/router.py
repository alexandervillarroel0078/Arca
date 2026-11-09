from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import Ctx, DbSession
from app.modulos.reportes import service
from app.modulos.reportes.schemas import PorCategoriaOut, PorMiembroOut, ResumenOut, TendenciaOut

# `tipo` dice contra que se compara (mes, semana y anio: el periodo anterior del mismo tipo; dia y rango: mismo largo)
TipoPeriodo = Literal["dia", "semana", "mes", "anio", "rango"]

router = APIRouter(prefix="/reportes", tags=["reportes"])


@router.get("/resumen", response_model=ResumenOut)
def resumen(
    db: DbSession, ctx: Ctx, mes: str | None = None, desde: date | None = None, hasta: date | None = None, tipo: TipoPeriodo | None = None
):
    return service.resumen(db, ctx, mes, desde, hasta, tipo)


@router.get("/por-categoria", response_model=PorCategoriaOut)
def por_categoria(
    db: DbSession, ctx: Ctx, mes: str | None = None, desde: date | None = None, hasta: date | None = None, tipo: TipoPeriodo | None = None
):
    return service.por_categoria(db, ctx, mes, desde, hasta, tipo)


@router.get("/por-miembro", response_model=PorMiembroOut)
def por_miembro(db: DbSession, ctx: Ctx, mes: str | None = None, desde: date | None = None, hasta: date | None = None):
    return service.por_miembro(db, ctx, mes, desde, hasta)


@router.get("/tendencia-mensual", response_model=TendenciaOut)
def tendencia_mensual(db: DbSession, ctx: Ctx, meses: int = Query(default=6, ge=1, le=24)):
    return service.tendencia_mensual(db, ctx, meses)
