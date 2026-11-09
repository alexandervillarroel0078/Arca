"""UNICO punto de filtrado por visibilidad (Fase 17). Toda consulta de movimientos, apoyos, devoluciones e historial
pasa por aqui: PROHIBIDO escribir reglas de visibilidad sueltas en un endpoint.

Quien ve un registro = su dueno, mas toda la familia si es 'familia', mas los elegidos si es 'elegidas'. El admin NO
ve lo privado de otros. Lo que no puedes ver se comporta como si NO EXISTIERA: 404 (nunca 403), con el mismo cuerpo que
un id inexistente.
"""
from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Contexto
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.historial.models import Historial
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad.models import Compartido

ENTIDAD = {Movimiento: "movimiento", Apoyo: "apoyo"}
ENTIDADES_CON_VISIBILIDAD = ("movimiento", "apoyo", "devolucion")


# ------------------------------------------------------------------ SQL
def condicion(ctx: Contexto, modelo):
    """Expresion SQL: 'este usuario puede ver este movimiento/apoyo'. Incluye el aislamiento por familia."""
    uid = ctx.usuario.id
    elegido = (
        select(Compartido.id)
        .where(
            Compartido.entidad == ENTIDAD[modelo], Compartido.entidad_id == modelo.id, Compartido.usuario_id == uid
        )
        .correlate(modelo)
        .exists()
    )
    return and_(
        modelo.familia_id == ctx.familia_id,
        or_(modelo.usuario_id == uid, modelo.visibilidad == "familia", and_(modelo.visibilidad == "elegidas", elegido)),
    )


def filtrar(consulta, ctx: Contexto, modelo):
    """Aplica el filtro a CUALQUIER consulta que lea movimientos o apoyos."""
    return consulta.where(condicion(ctx, modelo))


def condicion_devolucion(ctx: Contexto):
    """Una devolucion se ve si se ve su apoyo (hereda la visibilidad)."""
    return Devolucion.apoyo_id.in_(select(Apoyo.id).where(condicion(ctx, Apoyo)))


def condicion_historial(ctx: Contexto):
    """Entradas del historial que este usuario puede ver, segun la visibilidad ACTUAL del registro al que se refieren.

    Las entradas de categorias, miembros, usuarios y familia no dependen de la visibilidad. 'cambiar_visibilidad' solo
    la ve quien la hizo (el dueno)."""
    ve_mov = select(Movimiento.id).where(condicion(ctx, Movimiento))
    ve_apo = select(Apoyo.id).where(condicion(ctx, Apoyo))
    ve_dev = select(Devolucion.id).where(condicion_devolucion(ctx))
    datos = or_(
        Historial.entidad.notin_(ENTIDADES_CON_VISIBILIDAD),
        and_(Historial.entidad == "movimiento", Historial.entidad_id.in_(ve_mov)),
        and_(Historial.entidad == "apoyo", Historial.entidad_id.in_(ve_apo)),
        and_(Historial.entidad == "devolucion", Historial.entidad_id.in_(ve_dev)),
    )
    return and_(
        Historial.familia_id == ctx.familia_id,
        datos,
        or_(Historial.accion != "cambiar_visibilidad", Historial.usuario_id == ctx.usuario.id),
    )


# ------------------------------------------------------------------ Python
def compartidos_de(db: Session, entidad: str, ids) -> dict[int, list[int]]:
    ids = list(ids)
    if not ids:
        return {}
    salida: dict[int, list[int]] = {}
    for eid, uid in db.execute(
        select(Compartido.entidad_id, Compartido.usuario_id)
        .where(Compartido.entidad == entidad, Compartido.entidad_id.in_(ids))
        .order_by(Compartido.id)
    ):
        salida.setdefault(eid, []).append(uid)
    return salida


def puede_ver(db: Session, ctx: Contexto, obj: Movimiento | Apoyo) -> bool:
    """Misma regla que `condicion`, para un objeto ya cargado."""
    if obj is None or obj.familia_id != ctx.familia_id:
        return False
    if obj.usuario_id == ctx.usuario.id or obj.visibilidad == "familia":
        return True
    if obj.visibilidad != "elegidas":
        return False
    entidad = ENTIDAD[type(obj)]
    return ctx.usuario.id in compartidos_de(db, entidad, [obj.id]).get(obj.id, [])


def exigir_ver(db: Session, ctx: Contexto, obj, que: str):
    """404 con el mismo cuerpo si no existe, es de otra familia o no puedes verlo."""
    if not puede_ver(db, ctx, obj):
        raise HTTPException(status_code=404, detail=f"{que} no encontrado")
    return obj


def puede_editar(ctx: Contexto, obj: Movimiento | Apoyo) -> bool:
    """Solo el dueno edita lo privado o compartido. El admin edita todo lo que ve y es de 'familia' (como antes);
    lo compartido con personas elegidas es de solo lectura para todos menos el dueno."""
    return obj.usuario_id == ctx.usuario.id or (ctx.es_admin and obj.visibilidad == "familia")


def exigir_editar(ctx: Contexto, obj) -> None:
    """Se llama SIEMPRE despues de `exigir_ver` (lo que no ves es 404, lo que ves pero no es tuyo es 403)."""
    if not puede_editar(ctx, obj):
        if obj.visibilidad == "familia":
            raise HTTPException(status_code=403, detail="Solo puedes modificar lo que registraste tú")
        raise HTTPException(status_code=403, detail="Esto fue compartido contigo: solo lo puede modificar quien lo registró")


def puede_registrar_devolucion(ctx: Contexto, apoyo: Apoyo) -> bool:
    """En un apoyo de la familia cualquier miembro puede registrar una devolucion (como siempre); en uno privado o
    compartido con personas, solo su dueno."""
    return apoyo.usuario_id == ctx.usuario.id or apoyo.visibilidad == "familia"


def privados_propios(ctx: Contexto, modelo):
    """Condicion: registros del propio usuario que no son de toda la familia (para 'Incluye tus N registros privados')."""
    return and_(modelo.familia_id == ctx.familia_id, modelo.usuario_id == ctx.usuario.id, modelo.visibilidad != "familia")


def exigir_ver_entidad(db: Session, ctx: Contexto, entidad: str, entidad_id: int) -> None:
    """Para el historial de UN registro: si es un movimiento, apoyo o devolucion que no ves (o no existe) -> 404."""
    if entidad == "movimiento":
        exigir_ver(db, ctx, db.get(Movimiento, entidad_id), "Movimiento")
    elif entidad == "apoyo":
        exigir_ver(db, ctx, db.get(Apoyo, entidad_id), "Apoyo")
    elif entidad == "devolucion":
        d = db.get(Devolucion, entidad_id)
        exigir_ver(db, ctx, db.get(Apoyo, d.apoyo_id) if d is not None else None, "Devolución")
