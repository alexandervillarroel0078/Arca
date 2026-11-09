from datetime import date

from pydantic import BaseModel


class PeriodoOut(BaseModel):
    desde: date  # inclusivo
    hasta: date  # inclusivo
    etiqueta: str


class PeriodoActualOut(PeriodoOut):
    tipo: str
    es_actual: bool  # contiene el dia de hoy (zona America/La_Paz)
    hoy: date
    dia_inicio_mes: int
    anterior: PeriodoOut
    siguiente: PeriodoOut
