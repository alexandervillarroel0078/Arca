"""Privacidad del usuario: su preferencia por defecto y 'aplicar a mis registros anteriores'."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.deps import Ctx, DbSession
from app.modulos.apoyos.models import Apoyo
from app.modulos.familia.models import Miembro
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import cambios

router = APIRouter(prefix="/privacidad", tags=["privacidad"])


class PrivacidadOut(BaseModel):
    visibilidad_defecto: Literal["solo_yo", "familia"]
    registros_distintos: int  # tus registros que hoy NO tienen tu preferencia (los que cambiaria "aplicar")


class PrivacidadEditar(BaseModel):
    visibilidad_defecto: Literal["solo_yo", "familia"]


class AplicarIn(BaseModel):
    confirmar: bool = False
    cantidad: int | None = None  # cuantos viste en la confirmacion; si cambio, se pide confirmar de nuevo


class AplicarOut(BaseModel):
    afectados: int
    visibilidad: str


def _propios_distintos(db, ctx, modelo):
    return select(modelo).where(
        modelo.familia_id == ctx.familia_id, modelo.usuario_id == ctx.usuario.id,
        modelo.visibilidad != ctx.visibilidad_defecto,
    )


def _contar(db, ctx) -> int:
    total = 0
    for modelo in (Movimiento, Apoyo):
        total += db.scalar(select(func.count()).select_from(_propios_distintos(db, ctx, modelo).subquery())) or 0
    return total


@router.get("", response_model=PrivacidadOut)
def obtener(db: DbSession, ctx: Ctx):
    return PrivacidadOut(visibilidad_defecto=ctx.visibilidad_defecto, registros_distintos=_contar(db, ctx))  # type: ignore[arg-type]


@router.patch("", response_model=PrivacidadOut)
def editar(datos: PrivacidadEditar, db: DbSession, ctx: Ctx):
    """Cambia SOLO la preferencia para los registros nuevos. No toca los anteriores."""
    miembro = db.scalar(select(Miembro).where(Miembro.usuario_id == ctx.usuario.id, Miembro.familia_id == ctx.familia_id))
    miembro.visibilidad_defecto = datos.visibilidad_defecto
    db.commit()
    ctx.visibilidad_defecto = datos.visibilidad_defecto
    return obtener(db, ctx)


@router.post("/aplicar-defecto", response_model=AplicarOut)
def aplicar_defecto(datos: AplicarIn, db: DbSession, ctx: Ctx):
    """Pone tu preferencia a TODOS tus registros anteriores. Pide confirmacion explicita (`confirmar: true`) y, si se
    manda `cantidad`, que coincida con los que se afectarian ahora."""
    if not datos.confirmar:
        raise HTTPException(status_code=400, detail="Confirma para aplicar tu preferencia a tus registros anteriores")
    registros = []
    for modelo in (Movimiento, Apoyo):
        registros += list(db.scalars(_propios_distintos(db, ctx, modelo).with_for_update()))
    if datos.cantidad is not None and datos.cantidad != len(registros):
        raise HTTPException(
            status_code=409, detail=f"Ahora se afectarían {len(registros)} registros y no {datos.cantidad}: revisa y confirma de nuevo"
        )
    for obj in registros:
        cambios.aplicar(db, ctx, obj, ctx.visibilidad_defecto, None)
    db.commit()
    return AplicarOut(afectados=len(registros), visibilidad=ctx.visibilidad_defecto)


# ---------------------------------------------------------------- sincronizacion: lista autoritativa de lo visible
sincronizacion = APIRouter(prefix="/sincronizacion", tags=["sincronizacion"])


class VisiblesOut(BaseModel):
    movimientos: list[int]
    apoyos: list[int]


@sincronizacion.get("/visibles", response_model=VisiblesOut)
def visibles(db: DbSession, ctx: Ctx):
    """Los ids de TODO lo que este usuario puede ver ahora (solo ids, nada de datos). El telefono la usa para olvidar,
    tambien de su copia sin conexion, lo que dejo de ser visible (p. ej. alguien lo paso a privado)."""
    from app.modulos.visibilidad import service as vis

    return VisiblesOut(
        movimientos=list(db.scalars(vis.filtrar(select(Movimiento.id), ctx, Movimiento).order_by(Movimiento.id))),
        apoyos=list(db.scalars(vis.filtrar(select(Apoyo.id), ctx, Apoyo).order_by(Apoyo.id))),
    )
