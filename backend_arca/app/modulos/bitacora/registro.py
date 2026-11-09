"""Escritura de la bitacora. NUNCA tumba la peticion: si falla, deja el error en el log del servidor.

Dos formas de escribir:
- `en_transaccion`: eventos que CAMBIAN datos (clave, rol, desactivacion, registro). La fila va en la misma transaccion
  que el cambio (dentro de un SAVEPOINT: si la fila falla se descarta solo ella y el cambio sigue; si el cambio se
  revierte, la fila tambien).
- `aparte`: login fallido/bloqueado, acceso denegado, token invalido, etc. Sesion propia con su commit: el registro
  queda aunque la peticion falle.

Seguridad: el detalle solo admite llaves de una lista blanca y valores cortos; jamas claves, hashes, JWT, cuerpos de
peticiones ni la clave temporal.
"""
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modulos.bitacora.models import Bitacora

log = logging.getLogger("arca.bitacora")

EVENTOS = (
    "login_ok", "login_fallido", "login_bloqueado", "logout", "registro", "cambio_clave_ok", "cambio_clave_fallido",
    "restablecer_clave", "usuario_desactivado", "usuario_reactivado", "cambio_rol", "acceso_denegado",
    "token_invalido", "sincronizacion_rechazada",
)
# Llaves permitidas en `detalle` (lista blanca): nada que pueda contener secretos.
DETALLE_PERMITIDO = {
    "motivo", "ruta", "metodo", "status", "objetivo_id", "objetivo", "rol_antes", "rol_despues", "espera_segundos",
    "campos",
}
MAX_TEXTO = 160


@dataclass
class Origen:
    """De donde viene la peticion y quien es (se completa al autenticar)."""

    ip: str | None = None
    dispositivo: str | None = None
    bind: Any = None
    operacion: str | None = None  # X-Operacion-Id: la peticion viene de la cola de sincronizacion
    usuario_id: int | None = None
    familia_id: int | None = None
    registrado: bool = False  # ya se escribio el evento de esta falla (evita registrarla dos veces)


def fijar_origen(request: Request, db: Session = Depends(get_db)) -> Origen:
    """Dependencia de toda la API: guarda IP, dispositivo y la base de datos para poder registrar eventos.

    La IP es `request.client.host`: uvicorn ya la resuelve segun FORWARDED_ALLOW_IPS (no se lee X-Forwarded-For a mano).
    """
    ua = request.headers.get("user-agent")
    origen = Origen(
        ip=request.client.host if request.client else None,
        dispositivo=ua[:200] if ua else None,
        bind=db.get_bind(),
        operacion=request.headers.get("x-operacion-id"),
    )
    request.state.origen = origen
    db.info["origen"] = origen
    return origen


# ---------------------------------------------------------------- limites de ruido (en memoria, por proceso)
_candado = threading.Lock()
_ultimo: dict[tuple, float] = {}
MAX_LIMITES = 10_000


def permitir_cada(clave: tuple, segundos: int = 60) -> bool:
    """True como mucho una vez por `segundos` para esa clave (evita inundar la bitacora)."""
    ahora = time.monotonic()
    with _candado:
        previo = _ultimo.get(clave)
        if previo is not None and ahora - previo < segundos:
            return False
        if len(_ultimo) >= MAX_LIMITES:
            for k in [k for k, t in _ultimo.items() if ahora - t >= segundos]:
                del _ultimo[k]
            if len(_ultimo) >= MAX_LIMITES:
                _ultimo.clear()
        _ultimo[clave] = ahora
        return True


def reiniciar() -> None:
    """Solo para pruebas."""
    with _candado:
        _ultimo.clear()


# ---------------------------------------------------------------- construccion de la fila
def _texto(v: Any) -> Any:
    if isinstance(v, str):
        return v[:MAX_TEXTO]
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    if isinstance(v, (list, tuple)):
        return [_texto(x) for x in v][:10]
    return str(v)[:MAX_TEXTO]


def limpiar_detalle(detalle: dict | None) -> dict:
    """Solo llaves de la lista blanca y valores cortos."""
    out = {}
    for k, v in (detalle or {}).items():
        if k in DETALLE_PERMITIDO:
            out[k] = _texto(v)
        else:
            log.warning("Bitacora: se descarta la llave de detalle no permitida %r", k)
    return out


def _correo(correo: str | None) -> str | None:
    """Solo se guarda si parece un correo (si alguien escribe su clave en ese campo, no se guarda)."""
    if not correo:
        return None
    c = correo.strip().lower()
    return c[:254] if "@" in c and " " not in c else None


def _construir(
    origen: Origen | None, evento: str, resultado: str, familia_id: int | None, usuario_id: int | None,
    correo: str | None, detalle: dict | None,
) -> Bitacora:
    return Bitacora(
        familia_id=familia_id,
        usuario_id=usuario_id,
        correo_intentado=_correo(correo),
        evento=evento,
        resultado=resultado,
        ip=(origen.ip if origen else None),
        dispositivo=(origen.dispositivo[:200] if origen and origen.dispositivo else None),
        detalle=limpiar_detalle(detalle),
    )


# ---------------------------------------------------------------- API de escritura
def en_transaccion(
    db: Session, evento: str, *, resultado: str = "ok", familia_id: int | None = None, usuario_id: int | None = None,
    correo: str | None = None, detalle: dict | None = None,
) -> None:
    """Misma transaccion que el cambio de datos. Un fallo propio se registra en el log y no rompe la peticion."""
    try:
        fila = _construir(db.info.get("origen"), evento, resultado, familia_id, usuario_id, correo, detalle)
        with db.begin_nested():  # SAVEPOINT: si la fila falla, solo ella se descarta
            db.add(fila)
    except Exception:
        log.exception("Bitacora: no se pudo escribir el evento %r (la peticion continua)", evento)


def _escribir_aparte(bind: Any, fila_args: tuple) -> None:
    try:
        fila = _construir(*fila_args)
        if bind is None:
            raise RuntimeError("sin conexion a la base de datos para la bitacora")
        with Session(bind=bind, autoflush=False) as s:
            s.add(fila)
            s.commit()
    except Exception:
        log.exception("Bitacora: no se pudo escribir el evento %r (la peticion continua)", fila_args[1])


def aparte(
    db: Session, evento: str, *, resultado: str = "fallo", familia_id: int | None = None, usuario_id: int | None = None,
    correo: str | None = None, detalle: dict | None = None,
) -> None:
    """Sesion propia: el registro queda aunque la peticion falle o se revierta."""
    origen = db.info.get("origen")
    _escribir_aparte(db.get_bind(), (origen, evento, resultado, familia_id, usuario_id, correo, detalle))


def aparte_desde_origen(
    origen: Origen | None, evento: str, *, resultado: str = "fallo", familia_id: int | None = None,
    usuario_id: int | None = None, correo: str | None = None, detalle: dict | None = None,
) -> None:
    """Igual que `aparte` pero sin sesion (para los manejadores de errores)."""
    _escribir_aparte(origen.bind if origen else None, (origen, evento, resultado, familia_id, usuario_id, correo, detalle))
