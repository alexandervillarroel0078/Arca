"""Servidor SOLO para las pruebas E2E del frontend (Playwright).

Es la misma app de siempre (`app.main.app`) pero conectada a la base `arca_test`: NUNCA a `arca2` ni a `arca`.
Agrega dos rutas de apoyo que no existen en la app real:
  GET  /__e2e__/base   -> nombre de la base a la que esta conectado (las pruebas verifican que sea arca_test)
  POST /__e2e__/movimiento-sin-historial -> inserta un movimiento DIRECTO en la tabla (sin pasar por la API), para
                          simular un registro anterior a la funcion de historial (no tiene ninguna entrada)
  POST /__e2e__/reset  -> deja la base vacia con TRUNCATE ... CASCADE (nunca DELETE: el trigger de `historial`
                          rechaza UPDATE y DELETE y no se debilita)

Uso (lo levanta Playwright solo):  python -m uvicorn e2e.servidor:app --port 8199
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import text

from app.core.config import settings

# IMPORTANTE: esto va ANTES de importar app.core.db, que crea el engine con settings.database_url.
if settings.es_produccion:
    raise RuntimeError("El servidor E2E es solo para pruebas: no puede correr con ENTORNO=produccion.")
settings.database_url = settings.test_database_url
if not settings.database_url.rstrip("/").endswith("/arca_test"):
    raise RuntimeError(
        "El servidor E2E solo puede usar la base arca_test. Revisa TEST_DATABASE_URL en backend_arca/.env "
        f"(no debe apuntar a arca2 ni a arca)."
    )

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.modulos import registry  # noqa: E402,F401
from app.modulos.movimientos.models import Movimiento  # noqa: E402

if engine.url.database != "arca_test":  # doble comprobacion sobre la conexion real
    raise RuntimeError(f"Base inesperada para E2E: {engine.url.database}")

# Esquema limpio al arrancar (drop_all/create_all; create_all vuelve a crear el trigger de historial).
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)


@app.get("/__e2e__/base")
def base_actual():
    return {"base": engine.url.database}


@app.post("/__e2e__/reset")
def reset():
    tablas = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {tablas} RESTART IDENTITY CASCADE"))
    from app.core import limite

    limite.reiniciar()
    from app.modulos.bitacora import registro

    registro.reiniciar()
    return {"ok": True}


@app.post("/__e2e__/movimiento-sin-historial")
def movimiento_sin_historial(datos: dict):
    with SessionLocal() as db:
        m = Movimiento(
            familia_id=datos["familia_id"], usuario_id=datos["usuario_id"], tipo="gasto", monto=Decimal(str(datos["monto"])),
            fecha=date.today(), categoria_id=datos["categoria_id"], nota=datos["nota"],
        )
        db.add(m)
        db.commit()
        return {"id": m.id}
