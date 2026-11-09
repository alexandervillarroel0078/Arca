"""Genera `compartido/periodos_casos.json`: la tabla de casos que comparten el backend (Python) y el frontend (TypeScript)
para comprobar que ambos calculan EXACTAMENTE los mismos periodos. Se regenera con:

    .venv/Scripts/python.exe tests/generar_casos_periodos.py
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modulos.periodos import calculo  # noqa: E402

REFERENCIAS = [
    "2025-12-31", "2026-01-01", "2026-01-10", "2026-01-27", "2026-01-28", "2026-02-14", "2026-02-27", "2026-02-28",
    "2026-03-01", "2026-03-14", "2026-03-15", "2026-03-27", "2026-03-28", "2026-10-29", "2026-11-01", "2026-11-08",
    "2026-11-14", "2026-11-15", "2026-11-27", "2026-11-28", "2026-11-30", "2026-12-14", "2026-12-15", "2026-12-27",
    "2026-12-28", "2026-12-31", "2027-01-01", "2027-01-14", "2027-01-27", "2028-02-28", "2028-02-29", "2028-03-01",
    "2028-12-31", "2100-02-28", "2100-03-01",
]
RANGOS = [("2026-10-01", "2026-11-15"), ("2026-11-10", "2026-11-10"), ("2026-12-20", "2027-01-05"), ("2028-02-20", "2028-03-05")]


def _comparacion(tipo, d, h, dia) -> dict:
    cd, ch = calculo.periodo_comparacion(tipo, d, h, dia)
    return {"comparacion": [cd.isoformat(), ch.isoformat()], "comparacion_etiqueta": calculo.etiqueta_comparacion(tipo, d, h, dia)}


def generar() -> list[dict]:
    casos = []
    for dia in (1, 15, 28):
        for tipo in ("dia", "semana", "mes", "anio"):
            for ref in REFERENCIAS:
                d, h = calculo.calcular(tipo, date.fromisoformat(ref), dia)
                ad, ah = calculo.anterior(tipo, d, h, dia)
                sd, sh = calculo.siguiente(tipo, d, h, dia)
                casos.append({
                    "tipo": tipo, "dia_inicio_mes": dia, "referencia": ref,
                    "desde": d.isoformat(), "hasta": h.isoformat(), "etiqueta": calculo.etiqueta(tipo, d, h, dia),
                    "anterior": [ad.isoformat(), ah.isoformat()], "siguiente": [sd.isoformat(), sh.isoformat()],
                    **_comparacion(tipo, d, h, dia),
                })
    for desde, hasta in RANGOS:
        d, h = date.fromisoformat(desde), date.fromisoformat(hasta)
        ad, ah = calculo.anterior("rango", d, h)
        sd, sh = calculo.siguiente("rango", d, h)
        casos.append({
            "tipo": "rango", "dia_inicio_mes": 1, "referencia": desde, "desde": desde, "hasta": hasta,
            "etiqueta": calculo.etiqueta("rango", d, h), "anterior": [ad.isoformat(), ah.isoformat()],
            "siguiente": [sd.isoformat(), sh.isoformat()],
            **_comparacion("rango", d, h, 1),
        })
    return casos


RUTA = Path(__file__).resolve().parent.parent.parent / "compartido" / "periodos_casos.json"

if __name__ == "__main__":
    RUTA.write_text(json.dumps(generar(), ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"{len(generar())} casos en {RUTA}")
