"""Limite de intentos fallidos de login, simple y EN MEMORIA.

5 fallos por (IP, correo) en 10 minutos -> 429. Es por proceso: si el servicio corre con varios procesos cada uno
cuenta aparte (suficiente para frenar adivinar claves en una instalacion familiar con un solo proceso).
"""
import threading
import time
from collections import deque

MAX_FALLOS = 5
VENTANA_SEGUNDOS = 10 * 60
MAX_CLAVES = 10_000  # tope de memoria: se limpian las vencidas y, si aun asi se pasa, las mas viejas

_candado = threading.Lock()
_fallos: dict[tuple[str, str], deque[float]] = {}


def _clave(ip: str, email: str) -> tuple[str, str]:
    return ip, email.strip().lower()


def _vigentes(q: deque[float], ahora: float) -> deque[float]:
    while q and ahora - q[0] >= VENTANA_SEGUNDOS:
        q.popleft()
    return q


def segundos_de_espera(ip: str, email: str, ahora: float | None = None) -> int:
    """0 si puede intentar; si no, cuantos segundos faltan para que se libere el intento mas antiguo."""
    ahora = time.monotonic() if ahora is None else ahora
    with _candado:
        q = _fallos.get(_clave(ip, email))
        if not q:
            return 0
        _vigentes(q, ahora)
        if len(q) < MAX_FALLOS:
            return 0
        return max(1, int(VENTANA_SEGUNDOS - (ahora - q[0])) + 1)


def registrar_fallo(ip: str, email: str, ahora: float | None = None) -> None:
    ahora = time.monotonic() if ahora is None else ahora
    with _candado:
        if len(_fallos) >= MAX_CLAVES:
            for k in [k for k, q in _fallos.items() if not _vigentes(q, ahora)]:
                del _fallos[k]
            while len(_fallos) >= MAX_CLAVES:
                del _fallos[next(iter(_fallos))]
        _fallos.setdefault(_clave(ip, email), deque()).append(ahora)


def limpiar(ip: str, email: str) -> None:
    """Un ingreso correcto borra los fallos de esa IP y correo."""
    with _candado:
        _fallos.pop(_clave(ip, email), None)


def reiniciar() -> None:
    """Solo para pruebas."""
    with _candado:
        _fallos.clear()
