from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException

from app.core.deps import Ctx, DbSession
from app.modulos.familia.models import Familia
from app.modulos.periodos import calculo
from app.modulos.periodos.schemas import PeriodoActualOut, PeriodoOut

router = APIRouter(prefix="/periodos", tags=["periodos"])


def _salida(tipo: str, desde: date, hasta: date, dia: int) -> PeriodoOut:
    return PeriodoOut(desde=desde, hasta=hasta, etiqueta=calculo.etiqueta(tipo, desde, hasta, dia))


@router.get("/actual", response_model=PeriodoActualOut)
def actual(
    db: DbSession,
    ctx: Ctx,
    tipo: Literal["dia", "semana", "mes", "anio", "rango"] = "mes",
    referencia: date | None = None,
    desde: date | None = None,
    hasta: date | None = None,
):
    """El periodo de `tipo` que contiene a `referencia` (por defecto hoy en La Paz), con el anterior y el
    siguiente. Para `rango` se mandan `desde` y `hasta`. Solo es una vista: no cierra ni bloquea nada."""
    dia = db.get(Familia, ctx.familia_id).dia_inicio_mes
    hoy = calculo.hoy_la_paz()
    try:
        d, h = calculo.calcular(tipo, referencia or hoy, dia, desde, hasta)
        ant = calculo.anterior(tipo, d, h, dia)
        sig = calculo.siguiente(tipo, d, h, dia)
    except calculo.PeriodoInvalido as e:
        raise HTTPException(status_code=422, detail=str(e))
    return PeriodoActualOut(
        **_salida(tipo, d, h, dia).model_dump(),
        tipo=tipo,
        es_actual=calculo.contiene(d, h, hoy),
        hoy=hoy,
        dia_inicio_mes=dia,
        anterior=_salida(tipo, *ant, dia),
        siguiente=_salida(tipo, *sig, dia),
    )
