"""Calculo de periodos: UNICO lugar donde se decide que dias abarca un dia, semana, mes, anio o rango.

Son funciones puras (no tocan la base). El periodo es una VISTA (un filtro de fechas): no cierra ni
bloquea nada. Todas las fechas son DIAS LOCALES de America/La_Paz (nunca UTC); `desde` y `hasta` son
inclusivos. Bolivia no tiene horario de verano (siempre UTC-4).
"""
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Literal

try:
    from zoneinfo import ZoneInfo

    ZONA: tzinfo = ZoneInfo("America/La_Paz")
except Exception:  # sin base de zonas horarias instalada (p. ej. Windows sin `tzdata`): UTC-4 fijo es identico
    ZONA = timezone(timedelta(hours=-4), "America/La_Paz")

Tipo = Literal["dia", "semana", "mes", "anio", "rango"]
TIPOS: tuple[str, ...] = ("dia", "semana", "mes", "anio", "rango")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


class PeriodoInvalido(ValueError):
    """Datos que no forman un periodo (rango sin fechas, desde mayor que hasta, dia de inicio fuera de 1-28)."""


def ahora_utc() -> datetime:
    """El reloj del servidor. Las pruebas lo sustituyen para fijar la hora."""
    return datetime.now(timezone.utc)


def fecha_local(instante: datetime) -> date:
    """Dia local de La Paz de un instante. Un instante sin zona se toma como UTC."""
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=timezone.utc)
    return instante.astimezone(ZONA).date()


def hoy_la_paz() -> date:
    """'Hoy' para todo el sistema: el dia de La Paz, aunque en UTC ya sea otro dia."""
    return fecha_local(ahora_utc())


def _exigir_dia_inicio(dia_inicio_mes: int) -> None:
    if not isinstance(dia_inicio_mes, int) or isinstance(dia_inicio_mes, bool) or not 1 <= dia_inicio_mes <= 28:
        raise PeriodoInvalido("El día de inicio del mes debe ser un numero de 1 a 28")


def _inicio_de_mes_contable(ref: date, dia_inicio_mes: int) -> date:
    """Primer dia del periodo mensual que contiene a `ref`."""
    if ref.day >= dia_inicio_mes:
        return date(ref.year, ref.month, dia_inicio_mes)
    anio, mes = (ref.year - 1, 12) if ref.month == 1 else (ref.year, ref.month - 1)
    return date(anio, mes, dia_inicio_mes)


def _siguiente_inicio(inicio: date) -> date:
    anio, mes = (inicio.year + 1, 1) if inicio.month == 12 else (inicio.year, inicio.month + 1)
    return date(anio, mes, inicio.day)


def calcular(
    tipo: str,
    referencia: date,
    dia_inicio_mes: int = 1,
    desde: date | None = None,
    hasta: date | None = None,
) -> tuple[date, date]:
    """(desde, hasta) inclusivo del periodo de `tipo` que contiene a `referencia`.

    - dia: ese dia. semana: de lunes a domingo.
    - mes: del `dia_inicio_mes` de un mes al dia anterior del siguiente (con 1 es el mes calendario).
    - anio: del 1 de enero al 31 de diciembre.
    - rango: exactamente `desde`..`hasta` (la referencia no cuenta).
    """
    _exigir_dia_inicio(dia_inicio_mes)
    if tipo == "dia":
        return referencia, referencia
    if tipo == "semana":
        lunes = referencia - timedelta(days=referencia.weekday())
        return lunes, lunes + timedelta(days=6)
    if tipo == "mes":
        inicio = _inicio_de_mes_contable(referencia, dia_inicio_mes)
        return inicio, _siguiente_inicio(inicio) - timedelta(days=1)
    if tipo == "anio":
        return date(referencia.year, 1, 1), date(referencia.year, 12, 31)
    if tipo == "rango":
        if desde is None or hasta is None:
            raise PeriodoInvalido("Un rango necesita las fechas desde y hasta")
        if desde > hasta:
            raise PeriodoInvalido("La fecha desde no puede ser posterior a la fecha hasta")
        return desde, hasta
    raise PeriodoInvalido(f"Tipo de periodo desconocido: {tipo}")


def largo_en_dias(desde: date, hasta: date) -> int:
    return (hasta - desde).days + 1


def anterior(tipo: str, desde: date, hasta: date, dia_inicio_mes: int = 1) -> tuple[date, date]:
    """El periodo inmediatamente anterior (para las flechas). Dia, semana, mes y anio: el anterior del
    mismo tipo. Rango: el tramo del mismo largo justo antes."""
    if tipo == "rango":
        return mismo_largo_anterior(desde, hasta)
    return calcular(tipo, desde - timedelta(days=1), dia_inicio_mes)


def siguiente(tipo: str, desde: date, hasta: date, dia_inicio_mes: int = 1) -> tuple[date, date]:
    """El periodo inmediatamente posterior. Rango: el tramo del mismo largo justo despues."""
    if tipo == "rango":
        n = largo_en_dias(desde, hasta)
        return hasta + timedelta(days=1), hasta + timedelta(days=n)
    return calcular(tipo, hasta + timedelta(days=1), dia_inicio_mes)


def mismo_largo_anterior(desde: date, hasta: date) -> tuple[date, date]:
    """Para comparar: un tramo con el mismo numero de dias, inmediatamente antes de `desde`."""
    n = largo_en_dias(desde, hasta)
    return desde - timedelta(days=n), desde - timedelta(days=1)


def contiene(desde: date, hasta: date, dia: date) -> bool:
    return desde <= dia <= hasta


def fin_exclusivo(hasta: date) -> date:
    """Las consultas usan [desde, fin): el dia siguiente al ultimo."""
    return hasta + timedelta(days=1)


def _corto(d: date, con_anio: bool = False) -> str:
    return f"{d.day} {MESES_CORTOS[d.month - 1]}" + (f" {d.year}" if con_anio else "")


def etiqueta(tipo: str, desde: date, hasta: date, dia_inicio_mes: int = 1) -> str:
    """Texto legible: 'Noviembre 2026', '28 oct - 27 nov', '2026', '8 nov 2026'..."""
    if tipo == "dia" or desde == hasta:  # un solo dia, sea cual sea el tipo
        return _corto(desde, True)
    if tipo == "anio":
        return str(desde.year)
    if tipo == "mes":
        if desde.day == 1:
            return f"{MESES[desde.month - 1].capitalize()} {desde.year}"
        return f"{_corto(desde)} - {_corto(hasta)}"
    if desde.year == hasta.year:
        return f"{_corto(desde)} - {_corto(hasta, True)}"
    return f"{_corto(desde, True)} - {_corto(hasta, True)}"


def periodo_comparacion(tipo: str, desde: date, hasta: date, dia_inicio_mes: int = 1) -> tuple[date, date]:
    """Contra que periodo se compara uno (Reportes). Para mes, semana y anio es el periodo ANTERIOR DEL MISMO TIPO
    (el mismo que usa la flecha "anterior": el mes respeta `dia_inicio_mes`). Para dia y rango (y para cualquier
    tramo que no sea exactamente un periodo de su tipo) es un tramo del mismo largo inmediatamente antes."""
    if tipo in ("mes", "semana", "anio") and calcular(tipo, desde, dia_inicio_mes) == (desde, hasta):
        return anterior(tipo, desde, hasta, dia_inicio_mes)
    return mismo_largo_anterior(desde, hasta)


def etiqueta_comparacion(tipo: str, desde: date, hasta: date, dia_inicio_mes: int = 1) -> str:
    """'vs octubre 2026', 'vs 28 sep - 27 oct', 'vs 2025', 'vs 7 nov 2026'."""
    d, h = periodo_comparacion(tipo, desde, hasta, dia_inicio_mes)
    exacto = tipo in ("mes", "semana", "anio") and calcular(tipo, desde, dia_inicio_mes) == (desde, hasta)
    texto = etiqueta(tipo if exacto or tipo == "dia" else "rango", d, h, dia_inicio_mes)
    return f"vs {texto[0].lower()}{texto[1:]}"
