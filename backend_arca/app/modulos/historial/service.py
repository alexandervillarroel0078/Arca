"""Escritura y lectura del historial.

`registrar` NO hace commit: la entrada se agrega a la MISMA transaccion que el cambio, asi que si
falla una fallan las dos. NUNCA se guardan claves, hashes ni tokens: los cambios de clave solo
registran el texto "clave cambiada".
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.anulable import nombres_usuarios
from app.core.deps import Contexto
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.auth.models import Usuario
from app.modulos.categorias.models import Categoria
from app.modulos.familia.models import Familia
from app.modulos.historial.models import Historial
from app.modulos.historial.schemas import HistorialItem, HistorialPagina
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import service as vis

CLAVE_CAMBIADA = "clave cambiada"
# Campos que jamas deben aparecer en `cambios` (defensa extra por si alguien los pasa por error).
CAMPOS_PROHIBIDOS = {"password", "password_hash", "clave", "clave_actual", "clave_nueva", "token", "access_token"}


def a_json(v: Any) -> Any:
    """Convierte un valor a algo serializable en JSON de forma estable."""
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def cambio(antes: Any, despues: Any) -> dict:
    return {"antes": a_json(antes), "despues": a_json(despues)}


def creacion(datos: dict) -> dict:
    """Cambios de una creacion: todos los campos con valor, de nada -> valor."""
    return {k: cambio(None, v) for k, v in datos.items() if v is not None}


def diferencias(antes: dict, despues: dict) -> dict:
    """Solo los campos que realmente cambiaron: campo -> {antes, despues}."""
    return {k: cambio(antes.get(k), despues.get(k)) for k in despues if a_json(antes.get(k)) != a_json(despues.get(k))}


def solo_clave_cambiada() -> dict:
    return {"clave": CLAVE_CAMBIADA}


def registrar(
    db: Session,
    familia_id: int,
    usuario_id: int,
    entidad: str,
    entidad_id: int,
    accion: str,
    cambios: dict | None = None,
    motivo: str | None = None,
    fecha_cliente: datetime | None = None,
) -> Historial:
    """Agrega una entrada a la transaccion en curso (el que llama hace el commit)."""
    cambios = dict(cambios or {})
    for campo in CAMPOS_PROHIBIDOS & set(cambios):
        if cambios[campo] != CLAVE_CAMBIADA:  # solo se admite el texto fijo, nunca el valor de una clave
            raise ValueError(f"El campo '{campo}' no puede guardarse en el historial")
    op = db.info.get("operacion") or {}
    entrada = Historial(
        fecha_cliente=fecha_cliente or op.get("fecha_cliente"),
        uuid_operacion=op.get("uuid"),
        familia_id=familia_id,
        entidad=entidad,
        entidad_id=entidad_id,
        accion=accion,
        usuario_id=usuario_id,
        cambios=cambios,
        motivo=(motivo or "").strip() or None,
    )
    db.add(entrada)
    return entrada


def operacion_aplicada(db: Session, familia_id: int, uuid_operacion: str | None, entidad: str, entidad_id: int) -> bool:
    """True si esta operacion del cliente (mismo UUID) ya se aplico a este registro: reenviarla no hace nada."""
    if not uuid_operacion:
        return False
    return (
        db.scalar(
            select(Historial.id)
            .where(
                Historial.familia_id == familia_id,
                Historial.uuid_operacion == uuid_operacion,
                Historial.entidad == entidad,
                Historial.entidad_id == entidad_id,
            )
            .limit(1)
        )
        is not None
    )


# ---------------------------------------------------------------- lectura
def _etiquetas(db: Session, filas: list[Historial]) -> dict[tuple[str, int], str]:
    """Nombre legible de cada registro mencionado (nada se borra, asi que siempre existen)."""
    ids: dict[str, set[int]] = {}
    for f in filas:
        ids.setdefault(f.entidad, set()).add(f.entidad_id)
    out: dict[tuple[str, int], str] = {}
    if ids.get("movimiento"):
        for m in db.scalars(select(Movimiento).where(Movimiento.id.in_(ids["movimiento"]))):
            nombre_cat = db.get(Categoria, m.categoria_id).nombre if m.categoria_id else None
            base = (m.nota or "").strip() or nombre_cat or ("Ingreso" if m.tipo == "ingreso" else "Gasto")
            out[("movimiento", m.id)] = f"{'Ingreso' if m.tipo == 'ingreso' else 'Gasto'}: {base} (Bs {m.monto:.2f})"
    if ids.get("apoyo"):
        for a in db.scalars(select(Apoyo).where(Apoyo.id.in_(ids["apoyo"]))):
            out[("apoyo", a.id)] = f"Apoyo a {a.beneficiario} (Bs {a.monto:.2f})"
    if ids.get("devolucion"):
        filas_d = db.execute(
            select(Devolucion, Apoyo).join(Apoyo, Apoyo.id == Devolucion.apoyo_id).where(Devolucion.id.in_(ids["devolucion"]))
        ).all()
        for d, a in filas_d:
            out[("devolucion", d.id)] = f"Devolucion de {a.beneficiario} (Bs {d.monto:.2f})"
    if ids.get("categoria"):
        for c in db.scalars(select(Categoria).where(Categoria.id.in_(ids["categoria"]))):
            out[("categoria", c.id)] = f"Categoria {c.nombre}"
    if ids.get("familia"):
        for f in db.scalars(select(Familia).where(Familia.id.in_(ids["familia"]))):
            out[("familia", f.id)] = f"Familia {f.nombre}"
    usuarios = ids.get("miembro", set()) | ids.get("usuario", set())
    if usuarios:
        nombres = {u.id: u.nombre for u in db.scalars(select(Usuario).where(Usuario.id.in_(usuarios)))}
        for e in ("miembro", "usuario"):
            for i in ids.get(e, set()):
                out[(e, i)] = f"{'Miembro' if e == 'miembro' else 'Usuario'} {nombres.get(i, '')}".strip()
    return out


def listar(
    db: Session,
    ctx: Contexto,
    entidad: str | None,
    entidad_id: int | None,
    accion: str | None,
    usuario_id: int | None,
    desde: date | None,
    hasta: date | None,
    limite: int,
    desplazamiento: int,
    cronologico: bool,
) -> HistorialPagina:
    """Siempre limitado a la familia del usuario y a los registros que PUEDE ver (visibilidad actual), tambien el admin."""
    q = select(Historial).where(vis.condicion_historial(ctx))
    if entidad:
        q = q.where(Historial.entidad == entidad)
    if entidad_id is not None:
        q = q.where(Historial.entidad_id == entidad_id)
    if accion:
        q = q.where(Historial.accion == accion)
    if usuario_id:
        q = q.where(Historial.usuario_id == usuario_id)
    if desde:
        q = q.where(Historial.fecha >= datetime.combine(desde, datetime.min.time()).astimezone())
    if hasta:
        q = q.where(Historial.fecha < datetime.combine(hasta + timedelta(days=1), datetime.min.time()).astimezone())
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    orden = (Historial.fecha.asc(), Historial.id.asc()) if cronologico else (Historial.fecha.desc(), Historial.id.desc())
    filas = list(db.scalars(q.order_by(*orden).limit(limite).offset(desplazamiento)))
    nombres = nombres_usuarios(db, {f.usuario_id for f in filas})
    etiquetas = _etiquetas(db, filas)
    items = [
        HistorialItem(
            id=f.id,
            entidad=f.entidad,
            entidad_id=f.entidad_id,
            accion=f.accion,
            usuario_id=f.usuario_id,
            usuario_nombre=nombres.get(f.usuario_id, ""),
            fecha=f.fecha,
            cambios=f.cambios or {},
            motivo=f.motivo,
            fecha_cliente=f.fecha_cliente,
            etiqueta=etiquetas.get((f.entidad, f.entidad_id)),
        )
        for f in filas
    ]
    return HistorialPagina(items=items, total=total, hay_mas=desplazamiento + limite < total)
