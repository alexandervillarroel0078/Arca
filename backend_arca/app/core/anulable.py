"""Columnas y utilidades comunes de anulacion/edicion. NUNCA se borran filas: se anulan."""
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, event, false, select
from sqlalchemy.orm import Mapped, Session, mapped_column


class Anulable:
    """Mixin para movimientos, apoyos y devoluciones."""

    anulado: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    anulado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    anulado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    motivo_anulacion: Mapped[str | None] = mapped_column(String(300), nullable=True)
    editado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    editado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # UUID generado en el cliente: hace idempotente la creacion (registro offline que se reenvia).
    uuid_cliente: Mapped[str | None] = mapped_column(String(36), nullable=True, unique=True)
    # Fase 12: sube en 1 con cada cambio del registro. Las ediciones/anulaciones envian la version en la que
    # se basaron; si ya cambio en el servidor, responde 409 (nunca se pisa un cambio en silencio).
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


_CLAVE_SUBIDAS = "versiones_subidas"


@event.listens_for(Session, "before_flush")
def _subir_version(session, _ctx, _instances):
    """Sube `version` una sola vez por transaccion a cada registro que realmente cambio."""
    subidas = session.info.setdefault(_CLAVE_SUBIDAS, set())
    for obj in list(session.dirty):
        if isinstance(obj, Anulable) and id(obj) not in subidas and session.is_modified(obj):
            obj.version = (obj.version or 1) + 1
            subidas.add(id(obj))


@event.listens_for(Session, "after_transaction_end")
def _olvidar_subidas(session, transaction):
    if transaction.parent is None:  # fin de la transaccion real (commit o rollback)
        session.info.pop(_CLAVE_SUBIDAS, None)


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def marcar_edicion(obj: Anulable, usuario_id: int) -> None:
    obj.editado_por = usuario_id
    obj.editado_en = ahora()


def marcar_anulacion(obj: Anulable, usuario_id: int, motivo: str | None) -> None:
    obj.anulado = True
    obj.anulado_por = usuario_id
    obj.anulado_en = ahora()
    obj.motivo_anulacion = (motivo or "").strip() or None


def limpiar_anulacion(obj: Anulable) -> None:
    obj.anulado = False
    obj.anulado_por = None
    obj.anulado_en = None
    obj.motivo_anulacion = None


class AnulacionIn(BaseModel):
    motivo: str | None = Field(default=None, max_length=300)
    version_base: int | None = Field(default=None, ge=1)


class ReactivacionIn(BaseModel):
    version_base: int | None = Field(default=None, ge=1)


class AuditoriaOut(BaseModel):
    version: int
    uuid_cliente: str | None
    anulado: bool
    anulado_por_nombre: str | None
    anulado_en: datetime | None
    motivo_anulacion: str | None
    editado_por_nombre: str | None
    editado_en: datetime | None


def nombres_usuarios(db: Session, ids) -> dict[int, str]:
    from app.modulos.auth.models import Usuario

    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {u.id: u.nombre for u in db.scalars(select(Usuario).where(Usuario.id.in_(ids)))}


def auditoria(obj: Anulable, nombres: dict[int, str]) -> dict:
    return dict(
        version=obj.version or 1,
        uuid_cliente=obj.uuid_cliente,
        anulado=obj.anulado,
        anulado_por_nombre=nombres.get(obj.anulado_por) if obj.anulado_por else None,
        anulado_en=obj.anulado_en,
        motivo_anulacion=obj.motivo_anulacion,
        editado_por_nombre=nombres.get(obj.editado_por) if obj.editado_por else None,
        editado_en=obj.editado_en,
    )


def exigir_dueno_o_admin(es_admin: bool, usuario_actual: int, dueno_id: int | None) -> None:
    """El miembro solo toca lo suyo; el admin todo. Se valida siempre en el backend."""
    if not es_admin and dueno_id != usuario_actual:
        raise HTTPException(status_code=403, detail="Solo puedes modificar lo que registraste tu")


def exigir_activo(obj: Anulable, que: str) -> None:
    if obj.anulado:
        raise HTTPException(status_code=400, detail=f"{que} esta anulado: reactivalo antes de modificarlo")


def exigir_version(obj: Anulable, version_base: int | None, actual, que: str) -> None:
    """409 si el registro cambio en el servidor desde la version en la que se baso el cliente.

    `actual` es una funcion que devuelve la salida (Pydantic) del registro tal como esta en el servidor, para
    que el cliente pueda mostrar ambas versiones. Sin `version_base` (clientes anteriores a la Fase 12) no se valida.
    """
    if version_base is None or version_base == (obj.version or 1):
        return
    raise HTTPException(
        status_code=409,
        detail={
            "codigo": "conflicto_version",
            "mensaje": f"{que} cambio en el servidor mientras tanto",
            "version_actual": obj.version or 1,
            "version_base": version_base,
            "actual": jsonable_encoder(actual()),
        },
    )
