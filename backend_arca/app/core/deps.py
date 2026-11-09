"""Dependencias compartidas: sesion de BD y usuario autenticado."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import leer_token, motivo_token_invalido
from app.modulos.bitacora import registro as bitacora
from app.modulos.auth.models import Usuario
from app.modulos.familia.models import Miembro

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


@dataclass
class Contexto:
    usuario: Usuario
    familia_id: int
    rol: str
    # Fase 12: el cliente identifica cada operacion de la cola (idempotencia) y dice cuando la hizo el usuario.
    uuid_operacion: str | None = None
    fecha_cliente: datetime | None = None
    visibilidad_defecto: str = "familia"  # Fase 17: preferencia del miembro para sus registros nuevos

    @property
    def es_admin(self) -> bool:
        return self.rol == "admin"


def _leer_fecha_cliente(texto: str | None) -> datetime | None:
    """Fecha real de la accion segun el cliente. Nunca se acepta una fecha futura (se usa la del servidor)."""
    if not texto:
        return None
    try:
        f = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="X-Fecha-Cliente debe ser una fecha ISO")
    if f.tzinfo is None:
        f = f.replace(tzinfo=timezone.utc)
    ahora = datetime.now(timezone.utc)
    return ahora if f > ahora + timedelta(minutes=5) else f


def obtener_contexto(
    db: DbSession,
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    x_operacion_id: Annotated[str | None, Header()] = None,
    x_fecha_cliente: Annotated[str | None, Header()] = None,
) -> Contexto:
    no_autorizado = HTTPException(
        status_code=401, detail="No autenticado", headers={"WWW-Authenticate": "Bearer"}
    )
    if cred is None:
        raise no_autorizado
    origen = db.info.get("origen")
    ip = origen.ip if origen else None
    usuario_id = leer_token(cred.credentials)
    if usuario_id is None:
        # token invalido o vencido: como mucho un registro por IP cada minuto (para no inundar la bitacora)
        if bitacora.permitir_cada(("token_invalido", ip)):
            bitacora.aparte(db, "token_invalido", detalle={"motivo": motivo_token_invalido(cred.credentials)})
        raise no_autorizado
    usuario = db.get(Usuario, usuario_id)
    miembro = db.scalar(select(Miembro).where(Miembro.usuario_id == usuario_id)) if usuario else None
    if usuario is None or miembro is None:
        if bitacora.permitir_cada(("token_invalido", ip)):
            bitacora.aparte(db, "token_invalido", detalle={"motivo": "usuario_inexistente"})
        raise no_autorizado
    if origen:
        origen.usuario_id, origen.familia_id = usuario.id, miembro.familia_id
    if not miembro.activo:
        if bitacora.permitir_cada(("desactivado", usuario.id)):
            bitacora.aparte(
                db, "acceso_denegado", familia_id=miembro.familia_id, usuario_id=usuario.id,
                detalle={"motivo": "usuario_desactivado"},
            )
        raise HTTPException(status_code=401, detail="Tu cuenta está desactivada")
    uuid_operacion = None
    if x_operacion_id:
        try:
            uuid_operacion = str(UUID(x_operacion_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="X-Operacion-Id debe ser un UUID")
    fecha_cliente = _leer_fecha_cliente(x_fecha_cliente)
    # El historial lee esto al registrar (misma sesion = misma transaccion que el cambio).
    db.info["operacion"] = {"uuid": uuid_operacion, "fecha_cliente": fecha_cliente}
    return Contexto(
        usuario=usuario, familia_id=miembro.familia_id, rol=miembro.rol,
        uuid_operacion=uuid_operacion, fecha_cliente=fecha_cliente,
        visibilidad_defecto=miembro.visibilidad_defecto or "familia",
    )


Ctx = Annotated[Contexto, Depends(obtener_contexto)]


def exigir_admin(ctx: Ctx) -> Contexto:
    if not ctx.es_admin:
        raise HTTPException(status_code=403, detail="Solo un administrador puede hacer esto")
    return ctx


CtxAdmin = Annotated[Contexto, Depends(exigir_admin)]
