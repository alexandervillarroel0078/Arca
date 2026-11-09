"""Punto de entrada: solo ensambla los routers de cada modulo."""
import re

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.modulos.actividad.router import router as actividad_router
from app.modulos.apoyos.router import router as apoyos_router
from app.modulos.auth.router import router as auth_router
from app.modulos.bitacora import registro as bitacora
from app.modulos.bitacora.router import router as bitacora_router
from app.modulos.categorias.router import router as categorias_router
from app.modulos.familia.router import router as familia_router
from app.modulos.historial.router import router as historial_router
from app.modulos.movimientos.router import router as movimientos_router
from app.modulos.periodos.router import router as periodos_router
from app.modulos.reportes.router import router as reportes_router
from app.modulos.visibilidad.router import router as privacidad_router
from app.modulos.visibilidad.router import sincronizacion as sincronizacion_router

# En produccion no se publica la documentacion de la API (/docs, /redoc, /openapi.json).
_doc = {} if not settings.es_produccion else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="Arca", description="Control de gastos familiares", **_doc)

# CORS: en produccion SOLO los origenes de CORS_ORIGENES. En desarrollo ademas localhost y la red local (para probar
# desde el telefono).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origenes_cors,
    allow_origin_regex=None if settings.es_produccion else r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):\d+",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],  # no existe ningun DELETE ni PUT en la API
    allow_headers=["Authorization", "Content-Type", "X-Operacion-Id", "X-Fecha-Cliente"],
)

# fijar_origen guarda la IP y el dispositivo de cada peticion para la bitacora (Fase 15).
api = APIRouter(prefix="/api", dependencies=[Depends(bitacora.fijar_origen)])
for r in (
    auth_router, familia_router, categorias_router, movimientos_router, apoyos_router, actividad_router,
    historial_router, bitacora_router, periodos_router, reportes_router, privacidad_router,
    sincronizacion_router,
):
    api.include_router(r)


# ---- Bitacora (Fase 15): los rechazos (403 y operaciones de la cola) quedan registrados en una sesion aparte.
_MONTO_ENTRE_PARENTESIS = re.compile(r"\s*\([^)]*Bs\s*[\d.,]+[^)]*\)")
_MONTO = re.compile(r"\s*Bs\s*[\d.,]+")


def _sin_montos(texto: str) -> str:
    """Fase 17: el detalle de la bitacora lo puede leer el admin, y los mensajes de regla de negocio mencionan montos
    ("... supera lo pendiente (Bs 30.00)") de registros que quiza no puede ver. Solo se guardan ids (en la ruta) y motivo."""
    return _MONTO.sub("", _MONTO_ENTRE_PARENTESIS.sub("", texto)).strip()


def _registrar_rechazo(request: Request, status: int, detalle, campos: list[str] | None = None) -> None:
    origen = getattr(request.state, "origen", None)
    if origen is None or origen.registrado:
        return
    if isinstance(detalle, dict):  # p. ej. el 409 de version: solo el mensaje, nunca el registro del servidor
        detalle = detalle.get("mensaje") or detalle.get("codigo")
    motivo = _sin_montos(detalle) if isinstance(detalle, str) else "rechazado"
    datos = {"ruta": request.url.path, "metodo": request.method, "status": status, "motivo": motivo}
    if campos:
        datos["campos"] = campos
    if status == 403:
        bitacora.aparte_desde_origen(
            origen, "acceso_denegado", familia_id=origen.familia_id, usuario_id=origen.usuario_id, detalle=datos
        )
    # Una operacion de la cola de sincronizacion (lleva X-Operacion-Id) que el servidor rechaza por permisos, version
    # o regla de negocio.
    if origen.operacion and 400 <= status < 500 and status not in (401, 408, 429):
        bitacora.aparte_desde_origen(
            origen, "sincronizacion_rechazada", familia_id=origen.familia_id, usuario_id=origen.usuario_id, detalle=datos
        )


@app.exception_handler(StarletteHTTPException)
async def _error_http(request: Request, exc: StarletteHTTPException):
    await run_in_threadpool(_registrar_rechazo, request, exc.status_code, exc.detail)
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def _error_validacion(request: Request, exc: RequestValidationError):
    campos = sorted({str(e["loc"][-1]) for e in exc.errors() if e.get("loc")})
    await run_in_threadpool(_registrar_rechazo, request, 422, "Datos invalidos", campos)
    return await request_validation_exception_handler(request, exc)


@api.get("/salud", tags=["salud"])
def salud_api():
    """Sin autenticacion y sin datos internos: solo dice que el servicio responde (para el monitor de despliegue)."""
    return {"estado": "ok"}


app.include_router(api)


@app.get("/salud", include_in_schema=False)
def salud():
    return {"estado": "ok"}
