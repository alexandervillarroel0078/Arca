"""Utilidades de contrasenas (bcrypt) y tokens JWT."""
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

ALGORITMO = "HS256"


def hashear_clave(clave: str) -> str:
    return bcrypt.hashpw(clave.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_clave(clave: str, hash_guardado: str) -> bool:
    try:
        return bcrypt.checkpw(clave.encode("utf-8"), hash_guardado.encode("utf-8"))
    except ValueError:
        return False


def crear_token(usuario_id: int) -> str:
    expira = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expira_minutos)
    return jwt.encode({"sub": str(usuario_id), "exp": expira}, settings.jwt_secret, algorithm=ALGORITMO)


def leer_token(token: str) -> int | None:
    """Devuelve el id de usuario del token, o None si es invalido o expiro."""
    try:
        datos = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITMO])
        return int(datos["sub"])
    except (JWTError, KeyError, ValueError):
        return None


def motivo_token_invalido(token: str) -> str:
    """'vencido' si la firma es valida pero ya expiro; 'invalido' en cualquier otro caso (solo para la bitacora)."""
    try:
        jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITMO], options={"verify_exp": False})
        return "vencido"
    except JWTError:
        return "invalido"
