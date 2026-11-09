"""Tipos compartidos de los esquemas."""
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import Field, PlainSerializer

from app.modulos.periodos.calculo import fin_exclusivo, hoy_la_paz

# Monto positivo, hasta 2 decimales (Bs). En JSON sale como numero.
MontoPositivo = Annotated[
    Decimal,
    Field(gt=0, max_digits=12, decimal_places=2),
    PlainSerializer(float, return_type=float, when_used="json"),
]
# Monto calculado (puede ser cero o negativo), en JSON sale como numero.
Monto = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


def rango_mes(mes: str | None) -> tuple[date, date]:
    """Convierte 'AAAA-MM' (o None = mes actual) en (primer dia, primer dia del mes siguiente)."""
    if mes:
        try:
            anio, m = (int(x) for x in mes.split("-"))
            inicio = date(anio, m, 1)
        except (ValueError, TypeError):
            from fastapi import HTTPException

            raise HTTPException(status_code=422, detail="El mes debe tener el formato AAAA-MM")
    else:
        hoy = hoy_la_paz()
        inicio = hoy.replace(day=1)
    siguiente = date(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1)
    return inicio, siguiente


def rango_filtro(
    mes: str | None, desde: date | None, hasta: date | None, mes_actual_por_defecto: bool = False
) -> tuple[date | None, date | None]:
    """(inicio, fin_exclusivo) de un filtro de fechas; None = sin limite de ese lado.

    `desde`/`hasta` (inclusivos) mandan sobre `mes` ('AAAA-MM', mes calendario, se conserva por compatibilidad).
    """
    if desde is not None or hasta is not None:
        if desde is not None and hasta is not None and desde > hasta:
            from fastapi import HTTPException

            raise HTTPException(status_code=422, detail="La fecha desde no puede ser posterior a la fecha hasta")
        return desde, (fin_exclusivo(hasta) if hasta is not None else None)
    if mes or mes_actual_por_defecto:
        return rango_mes(mes)
    return None, None


def rango_completo(mes: str | None, desde: date | None, hasta: date | None) -> tuple[date, date]:
    """Como `rango_filtro` pero siempre con los dos lados (reportes): sin nada, el mes actual."""
    if (desde is None) != (hasta is None):
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Indica las dos fechas: desde y hasta")
    inicio, fin = rango_filtro(mes, desde, hasta, mes_actual_por_defecto=True)
    assert inicio is not None and fin is not None
    return inicio, fin
