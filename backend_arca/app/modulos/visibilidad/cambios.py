"""Escritura de la visibilidad: validar con quien se comparte, crear/cambiar y dejar la entrada en el historial."""
from fastapi import HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.anulable import marcar_edicion, nombres_usuarios
from app.core.deps import Contexto
from app.modulos.familia.models import Miembro
from app.modulos.historial import service as historial
from app.modulos.visibilidad.models import Compartido
from app.modulos.visibilidad.service import ENTIDAD, compartidos_de

Visibilidad = Literal["solo_yo", "familia", "elegidas"]


class VisibilidadIn(BaseModel):
    """Campos de 'Quien lo ve' que comparten crear, editar y el endpoint de visibilidad."""

    visibilidad: Visibilidad | None = None
    compartido_con: list[int] | None = Field(default=None, max_length=50)


class VisibilidadCambiar(VisibilidadIn):
    visibilidad: Visibilidad  # type: ignore[assignment]
    version_base: int | None = Field(default=None, ge=1)


def _validar_personas(db: Session, ctx: Contexto, ids: list[int] | None) -> list[int]:
    """Solo miembros ACTIVOS de la misma familia (y distintos del dueno). Cualquier otro id es un error generico."""
    unicos = sorted({i for i in (ids or []) if i != ctx.usuario.id})
    if not unicos:
        raise HTTPException(status_code=422, detail="Elige al menos una persona para compartir")
    validos = set(
        db.scalars(
            select(Miembro.usuario_id).where(
                Miembro.familia_id == ctx.familia_id, Miembro.activo.is_(True), Miembro.usuario_id.in_(unicos)
            )
        )
    )
    if validos != set(unicos):
        raise HTTPException(status_code=422, detail="Solo puedes compartir con miembros activos de tu familia")
    return unicos


def preparar_creacion(db: Session, ctx: Contexto, datos: VisibilidadIn) -> tuple[str, list[int]]:
    """Visibilidad de un registro NUEVO: la elegida, o la preferencia del miembro."""
    vis = datos.visibilidad or ctx.visibilidad_defecto or "familia"
    if vis == "elegidas":
        return vis, _validar_personas(db, ctx, datos.compartido_con)
    return vis, []


def guardar_personas(db: Session, ctx: Contexto, entidad: str, entidad_id: int, personas: list[int]) -> None:
    for uid in personas:
        db.add(Compartido(familia_id=ctx.familia_id, entidad=entidad, entidad_id=entidad_id, usuario_id=uid))


def aplicar(db: Session, ctx: Contexto, obj, visibilidad: str | None, compartido_con: list[int] | None) -> bool:
    """Cambia la visibilidad de un registro (el que llama ya comprobo que es el dueno). Devuelve si hubo cambio.

    La entrada del historial ('cambiar_visibilidad') solo la ve el dueno."""
    entidad = ENTIDAD[type(obj)]
    antes_vis = obj.visibilidad
    antes_ids = compartidos_de(db, entidad, [obj.id]).get(obj.id, [])
    nueva = visibilidad or antes_vis
    if nueva == "elegidas":
        nuevos = _validar_personas(db, ctx, compartido_con if compartido_con is not None else antes_ids)
    else:
        nuevos = []
    if nueva == antes_vis and set(nuevos) == set(antes_ids):
        return False
    for fila in db.scalars(select(Compartido).where(Compartido.entidad == entidad, Compartido.entidad_id == obj.id)):
        if fila.usuario_id not in nuevos:
            db.delete(fila)
    for uid in nuevos:
        if uid not in antes_ids:
            db.add(Compartido(familia_id=ctx.familia_id, entidad=entidad, entidad_id=obj.id, usuario_id=uid))
    obj.visibilidad = nueva
    marcar_edicion(obj, ctx.usuario.id)  # sube la version aunque solo cambie la lista de personas
    nombres = nombres_usuarios(db, set(antes_ids) | set(nuevos))
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, entidad, obj.id, "cambiar_visibilidad",
        {
            "visibilidad": historial.cambio(antes_vis, nueva),
            "compartido_con": historial.cambio(
                [nombres.get(i, "") for i in antes_ids], [nombres.get(i, "") for i in nuevos]
            ),
        },
    )
    return True
